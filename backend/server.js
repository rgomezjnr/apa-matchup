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

// Batch fetch lifetime stats for multiple aliases
app.post('/api/lifetime-stats/batch', async (req, res) => {
  const authToken = req.headers.authorization;
  const { aliasIds } = req.body;
  
  if (!authToken) {
    return res.status(401).json({ error: 'Authorization header required' });
  }

  if (!Array.isArray(aliasIds) || aliasIds.length === 0) {
    return res.status(400).json({ error: 'aliasIds array required' });
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

  // Build batch request (APA GraphQL supports array of operations)
  const operations = aliasIds.map(id => ({
    operationName: 'AliasSessionStats',
    query,
    variables: { id: parseInt(id, 10) },
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

// Scrape member profile page for lifetime stats (fallback)
app.get('/api/scrape-lifetime/:leagueSlug/:memberId/:aliasId/:format/:sessionId', async (req, res) => {
  const authToken = req.headers.authorization;
  const { leagueSlug, memberId, aliasId, format, sessionId } = req.params;
  
  if (!authToken) {
    return res.status(401).json({ error: 'Authorization header required' });
  }

  const formatPath = format === 'NINE' ? 'nine' : 'eight';
  const url = `https://league.poolplayers.com/${leagueSlug}/member/${memberId}/${aliasId}/${formatPath}/${sessionId}`;

  try {
    // Extract just the token part (remove "Bearer " if present)
    const token = authToken.replace('Bearer ', '');
    
    const response = await fetch(url, {
      headers: {
        'Cookie': `access_token=${token}`,
        'Accept': 'text/html,application/xhtml+xml',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ 
        error: 'Failed to fetch member page', 
        status: response.status 
      });
    }

    const html = await response.text();
    
    // Parse lifetime stats from HTML - looking for the stats in the page
    // The structure varies, so we try multiple patterns
    
    let matchesWon = null;
    let matchesPlayed = null;
    let defensiveShotAvg = null;
    
    // Pattern 1: Look for numbers near "WON" and "PLAYED" text
    const wonPatterns = [
      /(\d+)\s*<\/[^>]+>\s*<[^>]+>\s*WON/i,
      /WON[^<]*<[^>]+>\s*(\d+)/i,
      /"matchesWon":\s*(\d+)/i,
    ];
    
    const playedPatterns = [
      /(\d+)\s*<\/[^>]+>\s*<[^>]+>\s*PLAYED/i,
      /PLAYED[^<]*<[^>]+>\s*(\d+)/i,
      /"matchesPlayed":\s*(\d+)/i,
    ];
    
    const defAvgPatterns = [
      /defensiveShotAvg[^:]*:\s*([\d.]+)/i,
      /Defensive[^<]*<[^>]+>\s*([\d.]+)/i,
      /"defensiveShotAvg":\s*([\d.]+)/i,
    ];
    
    for (const pattern of wonPatterns) {
      const match = html.match(pattern);
      if (match) {
        matchesWon = parseInt(match[1], 10);
        break;
      }
    }
    
    for (const pattern of playedPatterns) {
      const match = html.match(pattern);
      if (match) {
        matchesPlayed = parseInt(match[1], 10);
        break;
      }
    }
    
    for (const pattern of defAvgPatterns) {
      const match = html.match(pattern);
      if (match) {
        defensiveShotAvg = parseFloat(match[1]);
        break;
      }
    }
    
    if (matchesWon !== null && matchesPlayed !== null) {
      const winPct = matchesPlayed > 0 ? (matchesWon / matchesPlayed) * 100 : 0;
      res.json({
        success: true,
        stats: {
          matchesWon,
          matchesPlayed,
          winPct,
          defensiveShotAvg,
        }
      });
    } else {
      // Return the HTML snippet for debugging
      const snippet = html.substring(0, 2000);
      res.json({
        success: false,
        error: 'Could not parse lifetime stats from HTML',
        htmlSnippet: snippet,
      });
    }
  } catch (error) {
    console.error('Scrape error:', error);
    res.status(500).json({ error: 'Failed to scrape member page', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`APA Matchup Backend running on port ${PORT}`);
});
