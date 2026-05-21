import Dexie, { type EntityTable } from 'dexie';
import { exportDB, importInto } from 'dexie-export-import';
import type {
  Team,
  Player,
  PlayerStats,
  PlayerMatchRecord,
  PlayerSessionStats,
  Match,
  GameResult,
  HeadToHead,
  SyncStatus,
  LiveMatch,
  AppConfig,
  Division,
} from './types';

// Define the database
class MatchUpDatabase extends Dexie {
  teams!: EntityTable<Team, 'id'>;
  players!: EntityTable<Player, 'id'>;
  playerStats!: EntityTable<PlayerStats, 'id'>;
  playerMatchRecords!: EntityTable<PlayerMatchRecord, 'id'>;
  playerSessionStats!: EntityTable<PlayerSessionStats, 'id'>;
  matches!: EntityTable<Match, 'id'>;
  gameResults!: EntityTable<GameResult, 'id'>;
  headToHead!: EntityTable<HeadToHead, 'id'>;
  syncStatus!: EntityTable<SyncStatus, 'id'>;
  liveMatches!: EntityTable<LiveMatch, 'id'>;
  config!: EntityTable<AppConfig, 'id'>;
  divisions!: EntityTable<Division, 'id'>;

  constructor() {
    super('MatchUpDB');
    
    // Version 4: Added aliasId to players for lifetime stats
    this.version(4).stores({
      teams: 'id, number, divisionId, isOurTeam',
      players: 'id, aliasId, memberId, memberNumber, teamId',
      playerStats: '++id, playerId, sessionId, [playerId+sessionId]',
      playerMatchRecords: 'id, playerId, opponentId, datePlayed',
      playerSessionStats: '++id, playerId, memberId, sessionId, [playerId+sessionId]',
      matches: 'id, divisionId, homeTeamId, awayTeamId, week, scheduledDate',
      gameResults: '++id, matchId, playerId, opponentId, [playerId+opponentId]',
      headToHead: '++id, [playerId+opponentId]',
      syncStatus: 'id',
      liveMatches: 'id, status',
      config: 'id',
      divisions: 'id',
    });
  }
}

export const db = new MatchUpDatabase();

// Helper functions
export async function getOurTeam(): Promise<Team | undefined> {
  return await db.teams.filter(t => t.isOurTeam === true).first();
}

export async function getAllTeams(): Promise<Team[]> {
  return await db.teams.toArray();
}

export async function getOpponentTeams(): Promise<Team[]> {
  return await db.teams.filter(t => t.isOurTeam === false).toArray();
}

export async function getTeamById(teamId: number): Promise<Team | undefined> {
  return await db.teams.get(teamId);
}

export async function getTeamPlayers(teamId: number): Promise<Player[]> {
  return await db.players.where('teamId').equals(teamId).toArray();
}

export async function getAllPlayers(): Promise<Player[]> {
  return await db.players.toArray();
}

export async function getPlayerById(playerId: number): Promise<Player | undefined> {
  return await db.players.get(playerId);
}

export async function getPlayerStats(playerId: number): Promise<PlayerStats[]> {
  return await db.playerStats.where('playerId').equals(playerId).toArray();
}

export async function getLatestPlayerStats(playerId: number): Promise<PlayerStats | undefined> {
  const stats = await db.playerStats.where('playerId').equals(playerId).toArray();
  return stats.sort((a, b) => (b.sessionId || '').localeCompare(a.sessionId || ''))[0];
}

export async function getHeadToHeadRecord(
  playerId: number,
  opponentId: number
): Promise<HeadToHead | undefined> {
  return await db.headToHead
    .where('[playerId+opponentId]')
    .equals([playerId, opponentId])
    .first();
}

export async function getUpcomingMatches(teamId: number): Promise<Match[]> {
  const now = new Date();
  return await db.matches
    .filter(m => 
      (m.homeTeamId === teamId || m.awayTeamId === teamId) && 
      new Date(m.scheduledDate) >= now &&
      m.status === 'UNPLAYED'
    )
    .toArray();
}

export async function getNextMatch(teamId: number): Promise<Match | undefined> {
  const upcoming = await getUpcomingMatches(teamId);
  return upcoming.sort((a, b) => 
    new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime()
  )[0];
}

export async function getMatchHistory(
  teamId1: number,
  teamId2: number
): Promise<Match[]> {
  return await db.matches
    .filter(m => 
      (m.homeTeamId === teamId1 && m.awayTeamId === teamId2) ||
      (m.homeTeamId === teamId2 && m.awayTeamId === teamId1)
    )
    .toArray();
}

export async function getAllMatches(): Promise<Match[]> {
  return await db.matches.toArray();
}

export async function getConfig(): Promise<AppConfig | undefined> {
  return await db.config.get('main');
}

export async function saveConfig(config: Omit<AppConfig, 'id'>): Promise<void> {
  await db.config.put({ ...config, id: 'main' });
}

export async function getSyncStatus(): Promise<SyncStatus> {
  const status = await db.syncStatus.get('main');
  return status || {
    id: 'main',
    lastSyncTime: null,
    syncInProgress: false,
    lastError: null,
    teamsCount: 0,
    playersCount: 0,
    matchesCount: 0,
  };
}

export async function updateSyncStatus(updates: Partial<SyncStatus>): Promise<void> {
  await db.syncStatus.put({ 
    ...(await getSyncStatus()),
    ...updates,
    id: 'main' 
  });
}

export async function clearAllData(): Promise<void> {
  await Promise.all([
    db.teams.clear(),
    db.players.clear(),
    db.playerStats.clear(),
    db.matches.clear(),
    db.gameResults.clear(),
    db.headToHead.clear(),
    db.liveMatches.clear(),
  ]);
  await updateSyncStatus({
    lastSyncTime: null,
    teamsCount: 0,
    playersCount: 0,
    matchesCount: 0,
  });
}

export async function downloadDatabaseBackup(): Promise<void> {
  const blob = await exportDB(db);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `MatchUpDB-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function restoreDatabaseBackup(file: File): Promise<void> {
  await importInto(db, file, { clearTablesBeforeImport: true });
}

// Export database instance
export default db;
