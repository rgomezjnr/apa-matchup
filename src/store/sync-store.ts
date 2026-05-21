import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { db, updateSyncStatus, getSyncStatus } from '../data/db';
import { apaClient, type GQLTeam, type GQLViewer, type GQLPlayer, type GQLMatch } from '../scraper/apa-client';
import { MY_TEAM_ID, MY_DIVISION_ID, MY_LEAGUE_SLUG, FORMAT, seedInitialData } from '../data/seed';
import type { SyncStatus, Team, Player, Match } from '../data/types';

interface SyncState {
  // Status
  syncStatus: SyncStatus;
  authToken: string | null;
  isValidToken: boolean;

  // Progress
  syncProgress: number;
  syncMessage: string;
  syncError: string | null;

  // Last sync timestamps
  lastScheduleSync: Date | null;
  lastRosterSync: Date | null;

  // APA session ID for member profile scraping (found in any profile URL: .../nine/139)
  apaSessionId: number | null;

  // Actions
  loadSyncStatus: () => Promise<void>;
  setAuthToken: (token: string) => Promise<boolean>;
  clearAuthToken: () => void;
  setApaSessionId: (id: number | null) => void;
  syncAll: (forceRefresh?: boolean) => Promise<void>;
  testConnection: () => Promise<{ success: boolean; message: string }>;
}

// Transform GQL team to our Team type
function transformTeam(gqlTeam: GQLTeam, isOurTeam: boolean): Team {
  return {
    id: gqlTeam.id,
    number: gqlTeam.number,
    name: gqlTeam.name,
    divisionId: gqlTeam.division?.id || MY_DIVISION_ID,
    leagueId: gqlTeam.league?.id,
    leagueSlug: gqlTeam.league?.slug,
    format: gqlTeam.division?.type || FORMAT,
    isOurTeam,
    sessionPoints: gqlTeam.sessionPoints,
    lastSynced: new Date(),
  };
}

// Transform GQL player to our Player type
function transformPlayer(gqlPlayer: GQLPlayer, teamId: number): Player {
  const winPct = gqlPlayer.matchesPlayed > 0
    ? (gqlPlayer.matchesWon / gqlPlayer.matchesPlayed) * 100
    : 0;

  return {
    id: gqlPlayer.id,
    aliasId: gqlPlayer.alias?.id || 0,
    memberId: gqlPlayer.member.id,
    memberNumber: gqlPlayer.memberNumber,
    name: gqlPlayer.displayName,
    skillLevel: gqlPlayer.skillLevel,
    teamId,
    matchesPlayed: gqlPlayer.matchesPlayed,
    matchesWon: gqlPlayer.matchesWon,
    ppm: gqlPlayer.ppm,
    pa: gqlPlayer.pa,
    winPct,
  };
}

// Transform GQL match to our Match type
function transformMatch(gqlMatch: GQLMatch, divisionId: number): Match | null {
  // Skip bye weeks and no-play weeks
  if (!gqlMatch.id || !gqlMatch.home || !gqlMatch.away) {
    return null;
  }
  
  const homePoints = gqlMatch.results?.find(r => r.homeAway === 'HOME')?.points.total;
  const awayPoints = gqlMatch.results?.find(r => r.homeAway === 'AWAY')?.points.total;
  
  return {
    id: gqlMatch.id,
    divisionId,
    week: gqlMatch.week,
    homeTeamId: gqlMatch.home.id,
    homeTeamName: gqlMatch.home.name,
    homeTeamNumber: gqlMatch.home.number,
    awayTeamId: gqlMatch.away.id,
    awayTeamName: gqlMatch.away.name,
    awayTeamNumber: gqlMatch.away.number,
    scheduledDate: new Date(gqlMatch.startTime),
    hostLocationName: gqlMatch.location?.name || '',
    hostLocationId: gqlMatch.location?.id || null,
    isScored: gqlMatch.isScored,
    status: gqlMatch.status,
    homePoints,
    awayPoints,
    description: gqlMatch.description,
  };
}

export const useSyncStore = create<SyncState>()(
  persist(
    (set, get) => ({
      syncStatus: {
        id: 'main',
        lastSyncTime: null,
        syncInProgress: false,
        lastError: null,
        teamsCount: 0,
        playersCount: 0,
        matchesCount: 0,
      },
      authToken: null,
      isValidToken: false,
      syncProgress: 0,
      syncMessage: '',
      syncError: null,
      lastScheduleSync: null,
      lastRosterSync: null,
      apaSessionId: null,

      loadSyncStatus: async () => {
        await seedInitialData();
        const status = await getSyncStatus();
        set({ syncStatus: status });
        
        // Restore token to apaClient from persisted state
        const { authToken } = get();
        if (authToken) {
          apaClient.setAuthToken(authToken);
          // Validate the restored token
          const isValid = apaClient.validateAuth();
          if (!isValid) {
            // Token is expired
            set({ isValidToken: false });
          }
        }
      },

      setAuthToken: async (token: string) => {
        apaClient.setAuthToken(token);
        
        const isValid = apaClient.validateAuth();
        const expiryInfo = apaClient.getTokenExpiryInfo();
        
        if (isValid && expiryInfo) {
          set({ 
            authToken: token, 
            isValidToken: true, 
            syncError: null,
            syncMessage: `Token valid for ${expiryInfo.minutesRemaining} minutes`,
          });
          return true;
        } else {
          apaClient.clearAuthToken();
          const errorMsg = expiryInfo && expiryInfo.minutesRemaining <= 0 
            ? `Token expired. Get a fresh one from APA.`
            : 'Invalid token format.';
          set({ 
            authToken: null, 
            isValidToken: false, 
            syncError: errorMsg,
          });
          return false;
        }
      },

      clearAuthToken: () => {
        apaClient.clearAuthToken();
        set({ authToken: null, isValidToken: false });
      },

      setApaSessionId: (id) => {
        set({ apaSessionId: id });
      },

      testConnection: async () => {
        const { authToken, isValidToken } = get();
        
        if (!authToken || !isValidToken) {
          return { success: false, message: 'No valid token set' };
        }
        
        try {
          const viewer = await apaClient.getViewer();
          return { 
            success: true, 
            message: `Connected as ${viewer.viewer.firstName} ${viewer.viewer.lastName}` 
          };
        } catch (error) {
          return { 
            success: false, 
            message: error instanceof Error ? error.message : 'Connection failed' 
          };
        }
      },

      syncAll: async (forceRefresh = false) => {
        const { authToken, isValidToken, lastRosterSync } = get();
        
        if (!authToken || !isValidToken) {
          set({ syncError: 'No valid token. Please set your APA token first.' });
          return;
        }

        if (apaClient.isTokenExpired(authToken)) {
          set({ 
            syncError: 'Token expired. Please get a fresh token from APA.',
            isValidToken: false,
          });
          return;
        }

        // Check if sync needed (rosters don't change often)
        const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
        if (!forceRefresh && lastRosterSync && lastRosterSync > sixHoursAgo) {
          set({ syncMessage: 'Data is up to date', syncProgress: 100 });
          return;
        }
        
        set({ 
          syncProgress: 0, 
          syncMessage: 'Starting sync...', 
          syncError: null 
        });
        
        await updateSyncStatus({ syncInProgress: true });
        
        try {
          // Step 1: Test connection
          set({ syncProgress: 5, syncMessage: 'Testing connection...' });
          const viewer = await apaClient.getViewer();
          console.log('Connected as:', viewer.viewer.firstName, viewer.viewer.lastName);
          
          // Step 2: Get viewer's teams with full roster + schedule.
          // Using viewer { teams } avoids the permission restriction on direct team(id) queries.
          set({ syncProgress: 10, syncMessage: 'Fetching your team data...' });
          console.log('[sync] Step 2: fetching viewer teams');
          const viewerData = await apaClient.getViewerTeams();
          const viewerTeams = (viewerData.viewer as GQLViewer & { teams?: GQLTeam[] }).teams ?? [];
          console.log('[sync] viewer teams:', viewerTeams.map(t => `${t.name} (${t.id})`));

          // Prefer the configured team ID, fall back to first team
          const ourGqlTeam = viewerTeams.find(t => t.id === MY_TEAM_ID) ?? viewerTeams[0];
          if (!ourGqlTeam) {
            throw new Error('No teams found for your account. Verify your token is current.');
          }
          if (ourGqlTeam.id !== MY_TEAM_ID) {
            console.warn(`[sync] MY_TEAM_ID ${MY_TEAM_ID} not found in viewer teams; using ${ourGqlTeam.name} (${ourGqlTeam.id})`);
          }

          const ourTeamData = { roster: ourGqlTeam, schedule: ourGqlTeam };

          if (!ourTeamData.roster) {
            throw new Error('Failed to fetch team roster. Check if team ID is correct.');
          }

          // Save our team
          const ourTeam = transformTeam(ourTeamData.roster, true);
          await db.teams.put(ourTeam);

          // Save our roster
          const ourPlayers = ourTeamData.roster.roster?.map(p =>
            transformPlayer(p, ourGqlTeam.id)
          ) || [];
          
          if (ourPlayers.length === 0) {
            console.warn('No players found in team roster');
          }
          
          await db.players.bulkPut(ourPlayers);
          
          set({ 
            syncProgress: 20, 
            syncMessage: `Saved ${ourPlayers.length} players from ${ourTeam.name}` 
          });
          
          // Step 3: Extract opponent team IDs from schedule
          const opponentTeamIds = new Set<number>();
          const matches: Match[] = [];
          const divisionId = ourGqlTeam.division?.id || MY_DIVISION_ID;

          for (const gqlMatch of ourTeamData.schedule.matches || []) {
            const match = transformMatch(gqlMatch, divisionId);
            if (match) {
              matches.push(match);
              
              // Track opponent teams
              if (gqlMatch.home && gqlMatch.home.id !== ourGqlTeam.id) {
                opponentTeamIds.add(gqlMatch.home.id);
              }
              if (gqlMatch.away && gqlMatch.away.id !== ourGqlTeam.id) {
                opponentTeamIds.add(gqlMatch.away.id);
              }
            }
          }
          
          // Save matches
          await db.matches.bulkPut(matches);
          set({ 
            syncProgress: 30, 
            syncMessage: `Saved ${matches.length} matches. Fetching opponent rosters...` 
          });
          
          // Step 4: Fetch all opponent team rosters in parallel
          const opponentIds = Array.from(opponentTeamIds);
          console.log('[sync] Step 4: fetching opponent rosters for teams:', opponentIds);

          let processed = 0;
          const totalOpponents = opponentIds.length;

          // Fetch in batches of 4 to avoid rate limiting
          for (let i = 0; i < opponentIds.length; i += 4) {
            const batch = opponentIds.slice(i, i + 4);
            console.log('[sync] Step 4 batch:', batch);
            const teamRosters = await apaClient.getMultipleTeamRosters(batch);
            
            for (const gqlTeam of teamRosters) {
              if (!gqlTeam) continue;
              
              // Save team
              const team = transformTeam(gqlTeam, false);
              await db.teams.put(team);
              
              // Save players
              const players = gqlTeam.roster?.map(p => 
                transformPlayer(p, gqlTeam.id)
              ) || [];
              await db.players.bulkPut(players);
              
              processed++;
              const progress = 30 + Math.round((processed / totalOpponents) * 60);
              set({ 
                syncProgress: progress, 
                syncMessage: `${team.name}: ${players.length} players (${processed}/${totalOpponents})` 
              });
            }
          }
          
          // Step 6: Fetch lifetime stats by summing member session history across all sessions
          set({ syncProgress: 92, syncMessage: 'Fetching lifetime stats...' });
          const allPlayers = await db.players.toArray();
          const seenMembers = new Set<number>();
          const uniqueMemberIds = allPlayers
            .filter(p => p.memberId > 0)
            .map(p => p.memberId)
            .filter(id => { if (seenMembers.has(id)) return false; seenMembers.add(id); return true; });

          // Introspect Alias type to find correct field names, then fetch lifetime stats
          const aliasFields = await apaClient.introspectType('Alias');
          console.log('[sync] Alias type fields:', aliasFields?.map(f => f.name));

          const seenAliases = new Set<number>();
          const uniqueAliasIds = allPlayers
            .filter(p => p.aliasId > 0)
            .map(p => p.aliasId)
            .filter(id => { if (seenAliases.has(id)) return false; seenAliases.add(id); return true; });

          console.log(`[sync] Fetching lifetime stats for ${uniqueAliasIds.length} unique aliases`);
          const BATCH = 20;
          for (let i = 0; i < uniqueAliasIds.length; i += BATCH) {
            const chunk = uniqueAliasIds.slice(i, i + BATCH);
            try {
              const results = await apaClient.getMultipleAliasLifetimeStats(chunk, FORMAT);
              for (let j = 0; j < chunk.length; j++) {
                const aliasId = chunk[j];
                const aliasData = results[j];
                if (!aliasData || typeof aliasData.matchesWon !== 'number') {
                  console.warn(`[sync] No lifetime stats for alias ${aliasId}:`, aliasData);
                  continue;
                }
                const winPct = (aliasData.matchesPlayed ?? 0) > 0
                  ? (aliasData.matchesWon / aliasData.matchesPlayed) * 100
                  : 0;
                const playersToUpdate = allPlayers.filter(p => p.aliasId === aliasId);
                for (const player of playersToUpdate) {
                  await db.players.update(player.id, {
                    lifetimeMatchesPlayed: aliasData.matchesPlayed,
                    lifetimeMatchesWon: aliasData.matchesWon,
                    lifetimeWinPct: winPct,
                    lifetimeDefensiveAvg: aliasData.defensiveShotAvg ?? undefined,
                  });
                }
                console.log(`✅ alias ${aliasId}: ${aliasData.matchesWon}W/${aliasData.matchesPlayed}P`);
              }
            } catch (err) {
              console.warn('[sync] Lifetime stats batch failed:', err);
            }
            const progress = 92 + Math.round(((i + BATCH) / uniqueAliasIds.length) * 6);
            set({ syncProgress: Math.min(progress, 98), syncMessage: `Lifetime stats: ${Math.min(i + BATCH, uniqueAliasIds.length)}/${uniqueAliasIds.length}` });
          }
          set({ syncProgress: 98, syncMessage: 'Finalizing...' });
          
          const teamsCount = await db.teams.count();
          const playersCount = await db.players.count();
          const matchesCount = await db.matches.count();
          
          await updateSyncStatus({
            syncInProgress: false,
            lastSyncTime: new Date(),
            lastError: null,
            teamsCount,
            playersCount,
            matchesCount,
          });
          
          set({ 
            syncStatus: await getSyncStatus(),
            syncProgress: 100,
            syncMessage: `Sync complete! ${teamsCount} teams, ${playersCount} players, ${matchesCount} matches`,
            lastRosterSync: new Date(),
            lastScheduleSync: new Date(),
          });
          
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Sync failed';
          console.error('Sync error:', error);
          
          await updateSyncStatus({ 
            syncInProgress: false,
            lastError: errorMsg,
          });
          
          set({ 
            syncError: errorMsg, 
            syncMessage: '',
            syncStatus: await getSyncStatus(),
          });
        }
      },
    }),
    {
      name: 'sync-store',
      partialize: (state) => ({
        authToken: state.authToken,
        isValidToken: state.isValidToken,
        lastScheduleSync: state.lastScheduleSync,
        lastRosterSync: state.lastRosterSync,
        apaSessionId: state.apaSessionId,
      }),
      onRehydrateStorage: () => (state) => {
        // Restore token to apaClient when store is rehydrated from localStorage
        if (state?.authToken) {
          apaClient.setAuthToken(state.authToken);
          // Validate token on rehydration
          const isValid = apaClient.validateAuth();
          if (!isValid) {
            // Token expired - update state
            state.isValidToken = false;
          }
        }
      },
    }
  )
);
