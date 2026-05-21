import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3001;

// CORS - allow requests from our frontend
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://localhost:5176',
    'https://apa-matchup.onrender.com'
  ],
  credentials: true
}));

app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Proxy GraphQL requests to APA
app.post('/api/graphql', async (req, res) => {
  const authToken = req.headers.authorization;
  
  if (!authToken) {
    return res.status(401).json({ error: 'Authorization header required' });
  }

  try {
    const response = await fetch('https://gql.poolplayers.com/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authToken,
        'Origin': 'https://league.poolplayers.com',
        'Referer': 'https://league.poolplayers.com/',
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('GraphQL proxy error:', error);
    res.status(500).json({ error: 'Failed to proxy request', details: error.message });
  }
});

// Fetch lifetime stats for a single alias
app.get('/api/lifetime-stats/:aliasId', async (req, res) => {
  const authToken = req.headers.authorization;
  const { aliasId } = req.params;
  
  if (!authToken) {
    return res.status(401).json({ error: 'Authorization header required' });
  }

  const query = `
    query AliasSessionStats($id: Int!) {
      alias(id: $id) {
        id
        displayName
        EightBallStats {
          id
          matchesWon
          matchesPlayed
          CLA
          defensiveShotAvg
          matchCountForLastTwoYrs
          lastPlayed
          __typename
        }
        NineBallStats {
          id
          matchesWon
          matchesPlayed
          CLA
          defensiveShotAvg
          matchCountForLastTwoYrs
          lastPlayed
          __typename
        }
        __typename
      }
    }
  `;

  try {
    const response = await fetch('https://gql.poolplayers.com/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authToken,
        'Origin': 'https://league.poolplayers.com',
        'Referer': 'https://league.poolplayers.com/',
      },
      body: JSON.stringify({
        operationName: 'AliasSessionStats',
        query,
        variables: { id: parseInt(aliasId, 10) },
      }),
    });

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Lifetime stats error:', error);
    res.status(500).json({ error: 'Failed to fetch lifetime stats', details: error.message });
  }
});

// Batch fetch lifetime stats for multiple aliases.
// Tries camelCase field names (nineBallStats/eightBallStats); falls back to PascalCase.
// Returns raw array of GQL responses so the client can inspect actual field names.
app.post('/api/lifetime-stats/batch', async (req, res) => {
  const authToken = req.headers.authorization;
  const { aliasIds } = req.body;

  if (!authToken) return res.status(401).json({ error: 'Authorization header required' });
  if (!Array.isArray(aliasIds) || aliasIds.length === 0) {
    return res.status(400).json({ error: 'aliasIds array required' });
  }

  const { format = 'NINE' } = req.body;
  const query = `
    query AliasLifetimeStats($id: Int!, $format: FormatTypeMapped!) {
      alias(id: $id) {
        id
        __typename
        matchesWon(format: $format)
        matchesPlayed(format: $format)
      }
    }
  `;

  const operations = aliasIds.map(id => ({
    operationName: 'AliasLifetimeStats',
    query,
    variables: { id: parseInt(id, 10), format },
  }));

  try {
    const response = await fetch('https://gql.poolplayers.com/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authToken,
        'Origin': 'https://league.poolplayers.com',
        'Referer': 'https://league.poolplayers.com/',
      },
      body: JSON.stringify(operations),
    });

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Batch lifetime stats error:', error);
    res.status(500).json({ error: 'Failed to fetch batch lifetime stats', details: error.message });
  }
});

// ── Scraping helpers ────────────────────────────────────────────────────────

const SCRAPE_HEADERS = (token) => ({
  'Cookie': `access_token=${token}`,
  'Accept': 'text/html,application/xhtml+xml',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
});

// Parse __NEXT_DATA__ JSON from an HTML page
function parseNextData(html) {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

// Recursively search an object for a node that has both matchesWon and matchesPlayed.
// Prefers NineBallStats / EightBallStats arrays (lifetime records on an Alias).
function findStats(obj, formatKey, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 15) return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const r = findStats(item, formatKey, depth + 1);
      if (r) return r;
    }
    return null;
  }
  // Prefer the named stats array (alias lifetime stats)
  if (Array.isArray(obj[formatKey]) && obj[formatKey].length > 0) {
    const s = obj[formatKey][0];
    if (typeof s?.matchesWon === 'number') return s;
  }
  // Also accept a plain stats object
  if (typeof obj.matchesWon === 'number' && typeof obj.matchesPlayed === 'number') {
    return obj;
  }
  for (const v of Object.values(obj)) {
    const r = findStats(v, formatKey, depth + 1);
    if (r) return r;
  }
  return null;
}

// Extract current session ID from a page's HTML.
// Looks for member profile URLs like /sandiego/member/123/456/nine/139
function extractSessionId(html, leagueSlug) {
  const patterns = [
    new RegExp(`/${leagueSlug}/member/\\d+/\\d+/(?:nine|eight)/(\\d+)`, 'i'),
    /\/member\/\d+\/\d+\/(?:nine|eight)\/(\d+)/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return parseInt(m[1], 10);
  }
  // Fall back: look in __NEXT_DATA__ for a session id
  const data = parseNextData(html);
  if (data) {
    const found = deepFindSessionId(data, 0);
    if (found) return found;
  }
  return null;
}

function deepFindSessionId(obj, depth) {
  if (!obj || typeof obj !== 'object' || depth > 12) return null;
  if (typeof obj.sessionId === 'number') return obj.sessionId;
  if (obj.session && typeof obj.session.id === 'number') return obj.session.id;
  for (const v of Object.values(obj)) {
    const r = deepFindSessionId(v, depth + 1);
    if (r) return r;
  }
  return null;
}

// Fetch and parse a single member profile page
async function scrapeMemberPage(token, leagueSlug, memberId, aliasId, formatPath, sessionId) {
  const url = `https://league.poolplayers.com/${leagueSlug}/member/${memberId}/${aliasId}/${formatPath}/${sessionId}`;
  const response = await fetch(url, { headers: SCRAPE_HEADERS(token) });
  if (!response.ok) return { error: `HTTP ${response.status}` };

  const html = await response.text();
  const formatKey = formatPath === 'nine' ? 'NineBallStats' : 'EightBallStats';

  // Try __NEXT_DATA__ JSON first
  const nextData = parseNextData(html);
  if (nextData) {
    const s = findStats(nextData, formatKey);
    if (s) {
      return {
        matchesWon: s.matchesWon,
        matchesPlayed: s.matchesPlayed ?? 0,
        defensiveShotAvg: s.defensiveShotAvg ?? s.defensiveShotAverage ?? null,
      };
    }
  }

  // Regex fallback
  const wonMatch = html.match(/"matchesWon"\s*:\s*(\d+)/) || html.match(/(\d+)\s*<\/[^>]+>\s*<[^>]+>\s*WON/i);
  const playedMatch = html.match(/"matchesPlayed"\s*:\s*(\d+)/) || html.match(/(\d+)\s*<\/[^>]+>\s*<[^>]+>\s*PLAYED/i);
  const defMatch = html.match(/"defensiveShotAvg"\s*:\s*([\d.]+)/);

  if (wonMatch && playedMatch) {
    return {
      matchesWon: parseInt(wonMatch[1], 10),
      matchesPlayed: parseInt(playedMatch[1], 10),
      defensiveShotAvg: defMatch ? parseFloat(defMatch[1]) : null,
    };
  }

  // Return a small HTML snippet to help debug if nothing matched
  return { error: 'Stats not found', htmlSnippet: html.substring(0, 1000) };
}

// ── Scraping endpoints ───────────────────────────────────────────────────────

// Discover the current APA session ID using a known player's member profile page.
// Requests the URL without a session ID; Next.js redirects to the current session's
// URL (e.g. /nine/139), and we extract the session ID from response.url.
app.get('/api/discover-session/:leagueSlug/:memberId/:aliasId/:format', async (req, res) => {
  const authToken = req.headers.authorization;
  const { leagueSlug, memberId, aliasId, format } = req.params;
  if (!authToken) return res.status(401).json({ error: 'Authorization header required' });

  const token = authToken.replace('Bearer ', '');
  const formatPath = format === 'NINE' ? 'nine' : 'eight';
  const url = `https://league.poolplayers.com/${leagueSlug}/member/${memberId}/${aliasId}/${formatPath}`;

  try {
    const response = await fetch(url, { headers: SCRAPE_HEADERS(token) });

    // Check the final URL after any redirects for a session ID
    const finalUrl = response.url;
    const urlMatch = finalUrl.match(/\/(?:nine|eight)\/(\d+)/);
    if (urlMatch) {
      const sessionId = parseInt(urlMatch[1], 10);
      console.log(`Discovered session ID ${sessionId} from redirect: ${finalUrl}`);
      return res.json({ sessionId });
    }

    // No redirect — search the returned page HTML
    const html = await response.text();
    const sessionId = extractSessionId(html, leagueSlug);
    if (sessionId) {
      console.log(`Discovered session ID ${sessionId} from page content`);
      return res.json({ sessionId });
    }

    // Return debug info so we can see what the page contains
    const nextData = parseNextData(html);
    console.warn('Session ID not found. finalUrl:', finalUrl);
    res.status(404).json({
      error: 'Session ID not found',
      finalUrl,
      nextDataKeys: nextData ? Object.keys(nextData) : null,
      htmlSnippet: html.substring(0, 400),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to discover session ID', details: error.message });
  }
});

// Batch scrape member profiles for lifetime stats (5 concurrent)
app.post('/api/scrape-members/batch', async (req, res) => {
  const authToken = req.headers.authorization;
  const { players, leagueSlug, format, sessionId } = req.body;
  if (!authToken) return res.status(401).json({ error: 'Authorization header required' });
  if (!Array.isArray(players) || !leagueSlug || !format || !sessionId) {
    return res.status(400).json({ error: 'players[], leagueSlug, format, sessionId required' });
  }

  const token = authToken.replace('Bearer ', '');
  const formatPath = format === 'NINE' ? 'nine' : 'eight';
  const CONCURRENCY = 5;
  const results = [];

  for (let i = 0; i < players.length; i += CONCURRENCY) {
    const chunk = players.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(({ memberId, aliasId }) =>
        scrapeMemberPage(token, leagueSlug, memberId, aliasId, formatPath, sessionId)
          .then(stats => ({ memberId, aliasId, stats }))
          .catch(err => ({ memberId, aliasId, stats: { error: err.message } }))
      )
    );
    results.push(...chunkResults);
    if (i + CONCURRENCY < players.length) {
      await new Promise(r => setTimeout(r, 250));
    }
  }

  res.json(results);
});

app.listen(PORT, () => {
  console.log(`APA Matchup Backend running on port ${PORT}`);
});
