// Seed data and configuration for APA Match-Up App

import { db } from './db';
import type { AppConfig } from './types';

// Your team's configuration — updated from APA sync (league.poolplayers.com)
export const MY_TEAM_ID = 12987919; // Glizzy Gang
export const MY_TEAM_NUMBER = '';   // populated by sync
export const MY_TEAM_NAME = 'Glizzy Gang';
export const MY_DIVISION_ID = 0;    // populated by sync
export const MY_LEAGUE_ID = 0;      // populated by sync
export const MY_LEAGUE_SLUG = 'sandiego';
export const FORMAT = 'NINE' as const;

// Division teams are discovered dynamically via sync; this list is just for initial DB seed
export const DIVISION_TEAMS: { id: number; number: string; name: string; isOurTeam: boolean }[] = [
  { id: 12987919, number: '', name: 'Glizzy Gang', isOurTeam: true },
];

export async function seedInitialData(): Promise<void> {
  // Check if config already exists
  const existingConfig = await db.config.get('main');
  if (existingConfig) {
    return; // Already seeded
  }

  // Create app config
  const config: AppConfig = {
    id: 'main',
    ourTeamId: MY_TEAM_ID,
    ourTeamNumber: MY_TEAM_NUMBER,
    ourTeamName: MY_TEAM_NAME,
    divisionId: MY_DIVISION_ID,
    leagueId: MY_LEAGUE_ID,
    format: FORMAT,
  };

  await db.config.put(config);

  // Seed teams
  for (const team of DIVISION_TEAMS) {
    await db.teams.put({
      id: team.id,
      number: team.number,
      name: team.name,
      divisionId: MY_DIVISION_ID,
      leagueId: MY_LEAGUE_ID,
      leagueSlug: MY_LEAGUE_SLUG,
      format: FORMAT,
      isOurTeam: team.isOurTeam,
    });
  }

  console.log('Initial data seeded!');
}

export async function getAppConfig(): Promise<AppConfig | undefined> {
  return db.config.get('main');
}

export async function getOurTeam() {
  return db.teams.get(MY_TEAM_ID);
}

export async function getOpponentTeams() {
  return db.teams.where('isOurTeam').equals(0).toArray();
}
