# APA Match-Up

An intelligent APA pool league match-up assistant powered by **Gemini AI**. Helps team captains make data-driven player selection decisions during matches.

## Features

- 🤖 **AI-Powered Recommendations** - Uses Gemini 2.0 Flash for intelligent matchup analysis
- 📊 **Real Player Stats** - Syncs with APA data for accurate win rates, PPM, and skill levels  
- 💬 **AI Chat Strategist** - Ask questions about matchups during your match
- 📱 **Mobile-First PWA** - Works offline after initial sync
- 🏆 **Live Match Tracking** - Track games, scores, and player usage

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Gemini API Key

1. Get your API key from [Google AI Studio](https://aistudio.google.com/apikey)
2. Create a `.env` file in the project root:

```
VITE_GEMINI_API_KEY=your_gemini_api_key_here
```

### 3. Run Development Server

```bash
npm run dev
```

### 4. Sync APA Data

1. Navigate to the **Sync** screen in the app
2. Log in to [league.poolplayers.com](https://league.poolplayers.com)
3. Open Developer Tools (F12) → Network tab
4. Find any request to `gql.poolplayers.com/graphql`
5. Copy the token from the `Authorization` header (after "Bearer ")
6. Paste in the app and sync

## Tech Stack

- **React + TypeScript** - UI framework
- **Vite** - Build tool
- **Tailwind CSS** - Styling
- **Zustand** - State management
- **Dexie.js** - IndexedDB for offline storage
- **Google Gemini API** - AI recommendations
- **PWA** - Installable offline-capable app

## AI Models Used

- **Gemini 2.0 Flash** (`gemini-2.0-flash`) - Fast, intelligent recommendations
- Context includes: Player stats, skill levels, win rates, PPM, head-to-head records, current match state

## License

MIT
