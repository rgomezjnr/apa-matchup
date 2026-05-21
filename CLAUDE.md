# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Setup

This is a **two-process** app. Both must run simultaneously:

```bash
# Terminal 1 — Frontend (Vite dev server on :5173)
npm run dev

# Terminal 2 — Backend (Express proxy on :3001)
cd backend && npm run dev
```

Other commands:
```bash
npm run build     # TypeScript compile + Vite build
npm run lint      # ESLint
npx tsc --noEmit  # Type-check only (no build output)
```

No test suite exists. Type-check with `npx tsc --noEmit` to validate changes.

## Required Environment Variables

Create `.env` in the project root:
```
VITE_GEMINI_API_KEY=your_gemini_api_key_here
```

## Team Configuration

The app is hardcoded to a specific APA team. To reconfigure:
- Edit `src/data/seed.ts` — `MY_TEAM_ID`, `MY_TEAM_NAME`, `MY_LEAGUE_SLUG`, `FORMAT`
- `FORMAT` is `'NINE'` (nine-ball) or `'EIGHT'` (eight-ball)

## Architecture

### Data Flow

```
APA GraphQL API (gql.poolplayers.com)
    ↓ via backend proxy (/api/graphql)
src/scraper/apa-client.ts   ← singleton APAClient, all APA API calls
    ↓
src/store/sync-store.ts     ← orchestrates full sync, writes to IndexedDB
    ↓
src/data/db.ts              ← Dexie (IndexedDB) schema and helpers
    ↓
src/store/team-store.ts     ← loads data into React state for UI
```

### Three Zustand Stores

- **`sync-store`** — APA auth token (persisted to localStorage), sync progress, `syncAll()` orchestration. This is where all APA data fetching lives.
- **`team-store`** — In-memory cache of teams/players/stats loaded from IndexedDB. Read-only from UI perspective.
- **`match-store`** — Live match state (persisted): current game, attendance, scores, AI chat history.

### Backend Proxy (`backend/server.js`)

Plain Express server. Its only purpose is bypassing browser CORS restrictions when calling `gql.poolplayers.com` and `league.poolplayers.com`. In production it runs on Render (`apa-matchup-backend.onrender.com`). Key endpoints:
- `POST /api/graphql` — Generic GQL proxy
- `POST /api/lifetime-stats/batch` — Batch alias stats (GQL)
- `POST /api/scrape-members/batch` — HTML scraping of member pages
- `GET /api/discover-session/:leagueSlug/:memberId/:aliasId/:format` — Session ID discovery

### APA API Access (Non-Captain Constraints)

The user is a regular player, not a team captain. Permission-restricted queries include:
- `team(id: $id) { roster }` — use `viewer { teams { roster } }` instead
- `member(id: $id) { aliases }` — permission denied
- `alias(id: $id) { NineBallStats/EightBallStats }` — those fields don't exist on `Alias` type

What works for non-captains:
- `viewer { teams { roster { ... alias { id } ... } } }` — own teams with full roster
- `team(id: $id)` via batch for opponent rosters (works when called from viewer's league context)
- `member(id: $id) { players { matchesWon matchesPlayed __typename } }` — all session player records (used for lifetime stats by summing + filtering by `NineBallPlayer`/`EightBallPlayer` typename)

### Sync Flow (`syncAll` in sync-store.ts)

1. Test connection via `getViewer()`
2. Fetch our team via `getViewerTeams()` (avoids captain restriction)
3. Extract opponent team IDs from the schedule
4. Batch-fetch opponent rosters via `getMultipleTeamRosters()` (batches of 4)
5. Fetch lifetime stats: batch-query `member(id) { players { matchesWon matchesPlayed __typename } }`, filter by `NineBallPlayer`/`EightBallPlayer`, sum for lifetime totals

### Player ID Types

Players have three distinct IDs — easy to confuse:
- `player.id` — session-specific player record ID (changes each APA session)
- `player.aliasId` — persistent identity across leagues (from `roster.alias.id`)
- `player.memberId` — member ID (from `roster.member.id`), used for `member(id)` queries

### Match Night Flow

`HomeScreen` → `OpponentSelectScreen` → `AttendanceScreen` → `CoinTossScreen` → `GameMatchupScreen` (loops per game) → `MatchSummaryScreen`

### Engine Layer (`src/engine/`)

Pure functions, no side effects:
- `matchup-calculator.ts` — ranks available players against an opponent
- `win-probability.ts` — calculates win probability given player stats
- `skill-level-tables.ts` — APA 9-ball skill level point tables
- `recommendation.ts` — formats recommendations for UI

### AI Integration (`src/services/gemini.ts`)

Uses `@google/genai` with Gemini 2.0 Flash. Called from `GameMatchupScreen` for matchup recommendations and in-match chat. API key via `VITE_GEMINI_API_KEY`.

### Database Schema (`src/data/db.ts`)

Dexie v4, IndexedDB, currently on schema version 4. Key tables: `teams`, `players`, `matches`, `liveMatches`, `syncStatus`, `config`. The `players` table indexes `aliasId` and `memberId` for lifetime stats queries.
