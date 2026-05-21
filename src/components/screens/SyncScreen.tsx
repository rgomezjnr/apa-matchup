import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSyncStore } from '../../store/sync-store';
import { useTeamStore } from '../../store/team-store';
import { LinearConfidence } from '../ui/ConfidenceMeter';
import { apaClient } from '../../scraper/apa-client';
import { db } from '../../data/db';
import type { Player } from '../../data/types';

export function SyncScreen() {
  const navigate = useNavigate();
  const {
    syncStatus,
    isValidToken,
    syncProgress,
    syncMessage,
    syncError,
    lastRosterSync,
    loadSyncStatus,
    setAuthToken,
    syncAll,
    testConnection,
  } = useSyncStore();
  
  const { loadTeams, loadAllPlayers } = useTeamStore();
  
  const [tokenInput, setTokenInput] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [debugPlayer, setDebugPlayer] = useState<Player | null>(null);

  useEffect(() => {
    initializeData();
  }, []);

  const initializeData = async () => {
    await loadSyncStatus();
    await loadTeams();
    await loadAllPlayers();
  };

  const handleSetToken = async () => {
    if (!tokenInput.trim()) return;
    setTestResult(null);
    const success = await setAuthToken(tokenInput.trim());
    if (success) {
      setTokenInput('');
      // Auto-test connection
      const result = await testConnection();
      setTestResult(result);
    }
  };

  const handleTestConnection = async () => {
    const result = await testConnection();
    setTestResult(result);
  };

  const handleSync = async () => {
    setIsSyncing(true);
    setTestResult(null);
    setDebugPlayer(null);
    try {
      await syncAll(true);
      await loadTeams();
      await loadAllPlayers();
      
      // Pick a random player to show debug stats
      const allPlayers = await db.players.toArray();
      if (allPlayers.length > 0) {
        const randomPlayer = allPlayers[Math.floor(Math.random() * allPlayers.length)];
        setDebugPlayer(randomPlayer);
        console.log('DEBUG - Random player stats:', randomPlayer);
      }
    } catch (error) {
      console.error('Sync failed:', error);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 p-4 pb-24">
      {/* Header */}
      <header className="mb-6">
        <button 
          onClick={() => navigate('/')}
          className="text-slate-400 hover:text-white mb-2 flex items-center gap-1"
        >
          ← Back
        </button>
        <h1 className="text-2xl font-bold text-white">Sync Data</h1>
        <p className="text-slate-400">Update player stats and rosters from APA</p>
      </header>

      {/* Sync Status */}
      <div className="mb-6 p-4 rounded-xl bg-slate-800/50 border border-slate-700">
        <h2 className="text-white font-semibold mb-3">📊 Current Data</h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-400">Last Sync</span>
            <span className="text-slate-300">
              {lastRosterSync 
                ? formatRelativeTime(new Date(lastRosterSync))
                : 'Never'}
            </span>
          </div>
          <div className="border-t border-slate-700 mt-2 pt-2">
            <div className="flex justify-between">
              <span className="text-slate-400">Teams</span>
              <span className="text-slate-300">{syncStatus.teamsCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Players</span>
              <span className="text-slate-300">{syncStatus.playersCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Matches</span>
              <span className="text-slate-300">{syncStatus.matchesCount}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Sync Progress */}
      {isSyncing && (
        <div className="mb-6 p-4 rounded-xl bg-blue-500/10 border border-blue-500/30">
          <div className="mb-3">
            <LinearConfidence value={syncProgress / 100} label="Progress" />
          </div>
          <p className="text-blue-400 text-sm text-center">{syncMessage}</p>
        </div>
      )}

      {/* Error Display */}
      {syncError && !isSyncing && (
        <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
          <p className="text-red-400 text-sm">❌ {syncError}</p>
        </div>
      )}

      {/* Debug Player Stats - shows after sync */}
      {debugPlayer && !isSyncing && (
        <div className="mb-6 p-4 rounded-xl bg-purple-500/10 border border-purple-500/30">
          <h3 className="text-purple-400 font-semibold mb-2">🔍 Debug: Random Player Stats</h3>
          <div className="text-sm font-mono space-y-1">
            <p className="text-white font-bold">{debugPlayer.name} (SL{debugPlayer.skillLevel})</p>
            <p className="text-slate-400">ID: {debugPlayer.id} | Member: {debugPlayer.memberId}</p>
            
            <div className="mt-2 pt-2 border-t border-purple-500/30">
              <p className="text-cyan-400 font-semibold">Current Session:</p>
              <p className="text-slate-300">
                {debugPlayer.matchesWon}W-{debugPlayer.matchesPlayed - debugPlayer.matchesWon}L 
                ({debugPlayer.winPct?.toFixed(1)}% win)
              </p>
              <p className="text-slate-300">PPM: {debugPlayer.ppm?.toFixed(2)} | PA: {((debugPlayer.pa || 0) * 100).toFixed(0)}%</p>
            </div>
            
            <div className="mt-2 pt-2 border-t border-purple-500/30">
              <p className="text-yellow-400 font-semibold">LIFETIME Stats:</p>
              {debugPlayer.lifetimeMatchesPlayed ? (
                <>
                  <p className="text-green-400">
                    ✅ {debugPlayer.lifetimeMatchesWon}W-{(debugPlayer.lifetimeMatchesPlayed || 0) - (debugPlayer.lifetimeMatchesWon || 0)}L 
                    ({debugPlayer.lifetimeWinPct?.toFixed(1)}% win)
                  </p>
                  <p className="text-slate-300">
                    Def Avg: {debugPlayer.lifetimeDefensiveAvg?.toFixed(2) || 'N/A'}
                  </p>
                </>
              ) : (
                <p className="text-red-400">❌ NO LIFETIME STATS FOUND</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Test Result */}
      {testResult && (
        <div className={`mb-6 p-4 rounded-xl ${testResult.success ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'} border`}>
          <p className={`text-sm ${testResult.success ? 'text-green-400' : 'text-red-400'}`}>
            {testResult.success ? '✓' : '✗'} {testResult.message}
          </p>
        </div>
      )}

      {/* Full Sync Button */}
      {isValidToken && (
        <div className="mb-6 p-4 rounded-xl bg-gradient-to-br from-green-500/20 to-emerald-500/20 border border-green-500/30">
          <h2 className="text-white font-semibold mb-2">🚀 Sync All Data</h2>
          <p className="text-slate-400 text-sm mb-4">
            Fetches your team roster, all opponent rosters, and full match schedule from APA.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleSync}
              disabled={isSyncing}
              className="flex-1 py-3 px-4 rounded-lg bg-green-500 text-white font-medium hover:bg-green-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSyncing ? 'Syncing...' : 'Sync Now'}
            </button>
            <button
              onClick={handleTestConnection}
              disabled={isSyncing}
              className="py-3 px-4 rounded-lg bg-slate-700 text-white font-medium hover:bg-slate-600 transition-colors disabled:opacity-50"
            >
              Test
            </button>
          </div>
        </div>
      )}

      {/* Auth Token Section */}
      <div className={`mb-6 p-4 rounded-xl border ${isValidToken ? 'bg-green-500/10 border-green-500/30' : 'bg-slate-800/50 border-slate-700'}`}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-white font-semibold">🔐 APA Authentication</h2>
          {isValidToken && <TokenExpiryBadge />}
        </div>
        <p className="text-slate-400 text-sm mb-4">
          {isValidToken 
            ? 'Connected to APA. You can sync all player stats and rosters.'
            : 'To sync data, you\'ll need your APA auth token (takes ~30 seconds).'}
        </p>
        
        {!isValidToken && (
          <div className="mb-4 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <p className="text-blue-400 text-sm font-medium mb-2">How to get your token:</p>
            <ol className="text-slate-400 text-sm space-y-1 list-decimal ml-4">
              <li>Go to <a href="https://league.poolplayers.com" target="_blank" rel="noopener" className="text-blue-400 underline">league.poolplayers.com</a> and log in</li>
              <li>Open Developer Tools (<span className="text-slate-300 font-mono">F12</span>)</li>
              <li>Click the <span className="text-slate-300">Network</span> tab</li>
              <li>Click on your team name or any page</li>
              <li>Find a request to <span className="text-slate-300 font-mono">gql.poolplayers.com</span></li>
              <li>Click it → Headers → find <span className="text-slate-300">Authorization</span></li>
              <li>Copy the <span className="text-emerald-400">eyJ...</span> part (not "Bearer ")</li>
            </ol>
            <p className="text-amber-400 text-xs mt-3">⚠️ Token expires in ~15 minutes. Sync immediately after copying!</p>
          </div>
        )}

        <div className="flex gap-2">
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder={isValidToken ? "Paste new token to replace..." : "Paste your token here (eyJ...)"}
            className="flex-1 px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white placeholder-slate-400 focus:border-blue-500 focus:outline-none font-mono text-sm"
          />
          <button
            onClick={handleSetToken}
            disabled={!tokenInput.trim()}
            className="px-4 py-2 rounded-lg bg-blue-500 text-white font-medium hover:bg-blue-400 transition-colors disabled:opacity-50"
          >
            {isValidToken ? 'Update' : 'Set Token'}
          </button>
        </div>
      </div>

      {/* Info about data */}
      {syncStatus.playersCount > 0 && (
        <div className="p-4 rounded-xl bg-slate-800/30 border border-slate-700/50">
          <p className="text-slate-500 text-xs text-center">
            Data is stored locally on your device for offline use.
            <br />
            Sync before each match night to get the latest stats.
          </p>
        </div>
      )}
    </div>
  );
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

function TokenExpiryBadge() {
  const [expiryInfo, setExpiryInfo] = useState<{ minutesRemaining: number } | null>(null);

  useEffect(() => {
    const updateExpiry = () => {
      const info = apaClient.getTokenExpiryInfo();
      setExpiryInfo(info);
    };
    
    updateExpiry();
    const interval = setInterval(updateExpiry, 10000); // Update every 10s
    return () => clearInterval(interval);
  }, []);

  if (!expiryInfo) return null;

  const { minutesRemaining } = expiryInfo;
  const isExpiringSoon = minutesRemaining <= 5;
  const isExpired = minutesRemaining <= 0;

  if (isExpired) {
    return (
      <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-400 text-xs animate-pulse">
        ⚠️ Expired - get new token
      </span>
    );
  }

  if (isExpiringSoon) {
    return (
      <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 text-xs">
        ⏱️ {minutesRemaining}m left - sync now!
      </span>
    );
  }

  return (
    <span className="px-2 py-0.5 rounded bg-green-500/20 text-green-400 text-xs">
      ✓ Connected ({minutesRemaining}m)
    </span>
  );
}
