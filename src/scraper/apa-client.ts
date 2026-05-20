// APA API Client - Handles both public and authenticated endpoints

const REST_API_URL = 'https://api.poolplayers.com';
const GRAPHQL_URL = 'https://gql.poolplayers.com/graphql';

// Backend proxy URL - use this for requests that need CORS bypass (lifetime stats)
const PROXY_URL = import.meta.env.PROD 
  ? 'https://apa-matchup-backend.onrender.com'
  : 'http://localhost:3001';

// GraphQL Response Types (based on actual APA API)
export interface GQLViewer {
  id: number;
  firstName: string;
  lastName: string;
  emailAddress: string;
  __typename: string;
}

export interface GQLLeague {
  id: number;
  name: string;
  slug: string;
  isMine: boolean;
  __typename: string;
}

export interface GQLDivision {
  id: number;
  name: string;
  type: 'NINE' | 'EIGHT';
  __typename: string;
}

export interface GQLTeam {
  id: number;
  name: string;
  number: string;
  isMine?: boolean;
  league?: { id: number; slug: string };
  division?: GQLDivision;
  roster?: GQLPlayer[];
  matches?: GQLMatch[];
  sessionPoints?: number;
  __typename: string;
}

export interface GQLPlayer {
  id: number; // This is the player ID (session-specific)
  memberNumber: string;
  displayName: string;
  matchesWon: number;
  matchesPlayed: number;
  pa: number; // Points awarded (as decimal 0-1)
  ppm: number; // Points per match
  skillLevel: number;
  member: { id: number };
  alias?: { id: number };
  __typename: string;
}

// Lifetime stats from alias query
export interface GQLNineBallLifetimeStats {
  id: number;
  matchesWon: number;
  matchesPlayed: number;
  CLA: number;
  defensiveShotAvg: number;
  matchCountForLastTwoYrs: number;
  lastPlayed: string | null;
  __typename: string;
}

export interface GQLAliasStats {
  alias: {
    id: number;
    displayName: string;
    NineBallStats: GQLNineBallLifetimeStats[];
    EightBallStats: GQLNineBallLifetimeStats[];
    __typename: string;
  };
}

export interface GQLMatch {
  id: number | null;
  week: number | null;
  type: 'NINE' | 'EIGHT' | null;
  status: 'COMPLETED' | 'UNPLAYED';
  startTime: string;
  isMine: boolean;
  isScored: boolean;
  isFinalized: boolean;
  description: string;
  location?: {
    id: number;
    name: string;
    address: { id: number; name: string };
  } | null;
  home?: { id: number; name: string; number: string; isMine: boolean } | null;
  away?: { id: number; name: string; number: string; isMine: boolean } | null;
  results?: {
    homeAway: 'HOME' | 'AWAY';
    points: { total: number };
  }[];
  __typename: string;
}

// Player match history (individual game results)
export interface GQLMatchHistoryItem {
  id: number;
  datePlayed: string;
  won: boolean;
  skillLevel: number;
  pointsAwarded: number;
  pointsNeeded: number;
  opponent: {
    id: number;
    displayName: string;
    skillLevel: number;
    __typename: string;
  };
  match?: {
    id: number;
    week: number;
    startTime: string;
    __typename: string;
  };
  team?: {
    id: number;
    name: string;
    __typename: string;
  };
  __typename: string;
}

export interface GQLPlayerMatchHistory {
  player: {
    id: number;
    displayName: string;
    skillLevel: number;
    memberNumber?: string;
    matchHistory: GQLMatchHistoryItem[];
    __typename: string;
  };
}

// Member session history (stats across multiple sessions)
export interface GQLSessionHistoryItem {
  id: number;
  skillLevel: number;
  matchesPlayed: number;
  matchesWon: number;
  ppm: number;
  pa: number;
  session: {
    id: number;
    name: string;
    year: number;
    __typename: string;
  };
  team: {
    id: number;
    name: string;
    number: string;
    __typename: string;
  };
  __typename: string;
}

export interface GQLMemberSessionHistory {
  member: {
    id: number;
    firstName: string;
    lastName: string;
    playerHistory: GQLSessionHistoryItem[];
    __typename: string;
  };
}

// Member lifetime stats
export interface GQLMemberStatsData {
  matchesWon: number;
  matchesPlayed: number;
  winPercentage: number;
  defensiveShotAverage: number;
  breakAndRuns: number;
  nineOnTheSnap: number;
  miniSlams: number;
  shutouts: number;
  pointsPerMatch: number;
  pointsAwarded: number;
  __typename: string;
}

export interface GQLMemberStats {
  member: {
    id: number;
    firstName: string;
    lastName: string;
    memberNumber: string;
    stats: GQLMemberStatsData | null;
    __typename: string;
  };
}

// REST API types (legacy, for public endpoints)
export interface APAScheduleItem {
  ScheduleDate: string;
  HomeTeamNumber: string;
  HomeTeamName: string;
  VisitingTeamNumber: string;
  VisitingTeamName: string;
  HostLocationName: string;
  Week: number;
  ScoresheetReportID: number;
  LeagueDivisionSessionScheduleMatchID: number;
  StartTime: string;
  FormatTypeListID: number;
  HostLocationID: number;
  IsMatchScored: number;
  Bye: boolean;
}

class APAClient {
  private authToken: string | null = null;

  setAuthToken(token: string) {
    this.authToken = token;
  }

  clearAuthToken() {
    this.authToken = null;
  }

  getAuthToken() {
    return this.authToken;
  }

  // Decode JWT payload without verification (for checking expiry)
  decodeToken(token: string): { exp?: number; sub?: string; iat?: number } | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const payload = JSON.parse(atob(parts[1]));
      return payload;
    } catch {
      return null;
    }
  }

  // Check if token is expired (with 1 minute buffer)
  isTokenExpired(token: string): boolean {
    const payload = this.decodeToken(token);
    if (!payload?.exp) return true;
    const now = Math.floor(Date.now() / 1000);
    return payload.exp < now + 60;
  }

  // Get token expiry info for UI
  getTokenExpiryInfo(): { expiresAt: Date; minutesRemaining: number } | null {
    if (!this.authToken) return null;
    const payload = this.decodeToken(this.authToken);
    if (!payload?.exp) return null;
    
    const expiresAt = new Date(payload.exp * 1000);
    const minutesRemaining = Math.max(0, Math.floor((payload.exp - Date.now() / 1000) / 60));
    return { expiresAt, minutesRemaining };
  }

  // Check if we have a valid auth token (by decoding JWT, no API call)
  validateAuth(): boolean {
    if (!this.authToken) return false;
    const payload = this.decodeToken(this.authToken);
    if (!payload) return false;
    if (this.isTokenExpired(this.authToken)) return false;
    return true;
  }

  // REST API request (for public endpoints)
  private async request<T>(endpoint: string): Promise<T> {
    const response = await fetch(`${REST_API_URL}${endpoint}`, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  // GraphQL API request - what APA website actually uses
  private async graphql<T>(
    operations: Array<{ operationName: string; query: string; variables?: Record<string, unknown> }>
  ): Promise<T[]> {
    if (!this.authToken) {
      throw new Error('Authentication required');
    }

    const response = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.authToken,
        'Apollographql-Client-Name': 'MemberServices',
        'Apollographql-Client-Version': '3.18.44-3550',
      },
      body: JSON.stringify(operations),
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Token expired. Please get a fresh token from APA.');
      }
      throw new Error(`GraphQL Error: ${response.status}`);
    }

    const results = await response.json();

    // Handle batch response (array of results)
    if (Array.isArray(results)) {
      const errors = results.filter(r => r.errors && r.errors.length > 0);
      if (errors.length > 0) {
        const failedOps = errors.map((r, i) => {
          const opName = operations[i]?.operationName || `op[${i}]`;
          const msgs = r.errors.map((e: { message: string }) => e.message).join(', ');
          return `${opName}: ${msgs}`;
        });
        console.error('GraphQL errors:', failedOps);
        throw new Error(failedOps.join('; '));
      }
      return results.map(r => r.data);
    }

    // Handle single response
    if (results.errors) {
      const opName = operations[0]?.operationName || 'unknown';
      const msg = results.errors[0]?.message || 'GraphQL error';
      console.error(`GraphQL error in ${opName}:`, results.errors);
      throw new Error(`${opName}: ${msg}`);
    }

    return [results.data];
  }

  // Single operation helper
  private async graphqlSingle<T>(
    operationName: string,
    query: string,
    variables?: Record<string, unknown>
  ): Promise<T> {
    const results = await this.graphql<T>([{ operationName, query, variables }]);
    return results[0];
  }

  // ========== PUBLIC ENDPOINTS (no auth) ==========
  
  async getDivisionSchedule(divisionId: string): Promise<APAScheduleItem[]> {
    return this.request<APAScheduleItem[]>(
      `/divisions/${divisionId}/division-schedule-info`
    );
  }

  // ========== GRAPHQL QUERIES (auth required) ==========

  // Get current viewer info
  async getViewer(): Promise<{ viewer: GQLViewer }> {
    const query = `
      query ViewerQuery {
        viewer {
          __typename
          id
          ... on Member {
            firstName
            lastName
            emailAddress
          }
        }
      }
    `;
    return this.graphqlSingle('ViewerQuery', query);
  }

  // Get viewer's own teams with full roster and schedule — avoids direct team(id) permission restrictions
  async getViewerTeams(): Promise<{ viewer: GQLViewer & { teams?: GQLTeam[] } }> {
    const query = `
      query ViewerWithTeams {
        viewer {
          __typename
          id
          ... on Member {
            firstName
            lastName
            emailAddress
            teams {
              id
              name
              number
              sessionPoints
              league { id slug __typename }
              division { id type __typename }
              roster {
                id
                memberNumber
                displayName
                matchesWon
                matchesPlayed
                skillLevel
                member { id __typename }
                alias { id __typename }
                __typename
                ... on NineBallPlayer { pa ppm }
                ... on EightBallPlayer { pa ppm }
              }
              matches {
                week
                type
                id
                status
                startTime
                isScored
                description
                location { id name __typename }
                home { id name number isMine __typename }
                away { id name number isMine __typename }
                results { homeAway points { total __typename } __typename }
                __typename
              }
              __typename
            }
          }
        }
      }
    `;
    return this.graphqlSingle('ViewerWithTeams', query);
  }

  // Get team roster with all player stats
  async getTeamRoster(teamId: number): Promise<{ team: GQLTeam }> {
    const query = `
      query teamRoster($id: Int!) {
        team(id: $id) {
          id
          name
          number
          league {
            id
            slug
            __typename
          }
          division {
            id
            type
            __typename
          }
          roster {
            id
            memberNumber
            displayName
            matchesWon
            matchesPlayed
            skillLevel
            __typename
            member {
              id
              __typename
            }
            ... on NineBallPlayer {
              pa
              ppm
            }
            ... on EightBallPlayer {
              pa
              ppm
            }
          }
          __typename
        }
      }
    `;
    return this.graphqlSingle('teamRoster', query, { id: teamId });
  }

  // Get team schedule with all matches
  async getTeamSchedule(teamId: number): Promise<{ team: GQLTeam }> {
    const query = `
      query teamSchedule($id: Int!) {
        team(id: $id) {
          id
          sessionBonusPoints
          sessionPoints
          sessionTotalPoints
          division {
            id
            isTournament
            __typename
          }
          matches {
            week
            type
            id
            isBye
            status
            scoresheet
            startTime
            isMine
            isPaid
            isScored
            isFinalized
            isPlayoff
            description
            tableNumber
            results {
              homeAway
              points {
                total
                __typename
              }
              __typename
            }
            timeZone {
              id
              name
              __typename
            }
            location {
              id
              name
              address {
                id
                name
                __typename
              }
              __typename
            }
            home {
              id
              name
              number
              isMine
              __typename
            }
            away {
              id
              name
              number
              isMine
              __typename
            }
            league {
              id
              isMine
              slug
              isElectronicPaymentsEnabled
              __typename
            }
            division {
              id
              scheduleInEdit
              isTournament
              __typename
            }
            __typename
          }
          __typename
        }
      }
    `;
    return this.graphqlSingle('teamSchedule', query, { id: teamId });
  }

  // Get both roster and schedule for a team (batch request)
  async getTeamFull(teamId: number): Promise<{ roster: GQLTeam; schedule: GQLTeam }> {
    const rosterQuery = `
      query teamRoster($id: Int!) {
        team(id: $id) {
          id
          name
          number
          league { id slug __typename }
          division { id type __typename }
          roster {
            id
            memberNumber
            displayName
            matchesWon
            matchesPlayed
            skillLevel
            member { id __typename }
            __typename
            ... on NineBallPlayer {
              pa
              ppm
            }
            ... on EightBallPlayer {
              pa
              ppm
            }
          }
          __typename
        }
      }
    `;
    
    const scheduleQuery = `
      query teamSchedule($id: Int!) {
        team(id: $id) {
          id
          sessionPoints
          matches {
            week
            type
            id
            status
            startTime
            isScored
            description
            location { id name __typename }
            home { id name number isMine __typename }
            away { id name number isMine __typename }
            results { homeAway points { total __typename } __typename }
            __typename
          }
          __typename
        }
      }
    `;
    
    const results = await this.graphql<{ team: GQLTeam }>([
      { operationName: 'teamRoster', query: rosterQuery, variables: { id: teamId } },
      { operationName: 'teamSchedule', query: scheduleQuery, variables: { id: teamId } },
    ]);
    
    return {
      roster: results[0].team,
      schedule: results[1].team,
    };
  }

  // Get member's aliases (to find alias ID for lifetime stats)
  async getMemberAliases(memberId: number): Promise<{ member: { id: number; aliases: Array<{ id: number; league: { id: number } }> } }> {
    const query = `
      query MemberAliases($id: Int!) {
        member(id: $id) {
          id
          aliases {
            id
            league {
              id
              __typename
            }
            __typename
          }
          __typename
        }
      }
    `;
    return this.graphqlSingle('MemberAliases', query, { id: memberId });
  }

  // Batch fetch member aliases
  async getMultipleMemberAliases(memberIds: number[]): Promise<Array<{ member: { id: number; aliases: Array<{ id: number; league: { id: number } }> } }>> {
    const query = `
      query MemberAliases($id: Int!) {
        member(id: $id) {
          id
          aliases {
            id
            league {
              id
              __typename
            }
            __typename
          }
          __typename
        }
      }
    `;
    
    const operations = memberIds.map(id => ({
      operationName: 'MemberAliases',
      query,
      variables: { id },
    }));
    
    return this.graphql(operations);
  }

  // Get lifetime stats for an alias via backend proxy (bypasses CORS)
  async getAliasLifetimeStats(aliasId: number): Promise<GQLAliasStats> {
    if (!this.authToken) {
      throw new Error('Authentication required');
    }

    const response = await fetch(`${PROXY_URL}/api/lifetime-stats/${aliasId}`, {
      headers: {
        'Authorization': this.authToken,
      },
    });

    if (!response.ok) {
      throw new Error(`Proxy request failed: ${response.status}`);
    }

    const result = await response.json();
    
    if (result.errors) {
      throw new Error(`GraphQL error: ${result.errors.map((e: { message: string }) => e.message).join('; ')}`);
    }

    return result;
  }

  // Batch fetch lifetime stats for multiple aliases via backend proxy
  async getMultipleAliasLifetimeStats(aliasIds: number[]): Promise<GQLAliasStats[]> {
    if (!this.authToken) {
      throw new Error('Authentication required');
    }

    const response = await fetch(`${PROXY_URL}/api/lifetime-stats/batch`, {
      method: 'POST',
      headers: {
        'Authorization': this.authToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ aliasIds }),
    });

    if (!response.ok) {
      throw new Error(`Proxy batch request failed: ${response.status}`);
    }

    const results = await response.json();
    
    // Handle array of results
    if (Array.isArray(results)) {
      return results.map(result => {
        if (result.errors) {
          console.warn('GraphQL error in batch:', result.errors);
          return { data: { alias: null } };
        }
        return result;
      });
    }

    return results;
  }

  // Get member's lifetime stats (deprecated - use getAliasLifetimeStats instead)
  async getMemberStats(memberId: number, format: 'NINE' | 'EIGHT' = 'NINE'): Promise<GQLMemberStats> {
    const query = `
      query memberStats($id: Int!, $format: FormatType!) {
        member(id: $id) {
          id
          firstName
          lastName
          memberNumber
          stats(format: $format) {
            matchesWon
            matchesPlayed
            winPercentage
            defensiveShotAverage
            breakAndRuns
            nineOnTheSnap
            miniSlams
            shutouts
            pointsPerMatch
            pointsAwarded
            __typename
          }
          __typename
        }
      }
    `;
    return this.graphqlSingle('memberStats', query, { id: memberId, format });
  }

  // Fetch multiple members' lifetime stats
  async getMultipleMemberStats(memberIds: number[], format: 'NINE' | 'EIGHT' = 'NINE'): Promise<GQLMemberStats[]> {
    const query = `
      query memberStats($id: Int!, $format: FormatType!) {
        member(id: $id) {
          id
          firstName
          lastName
          memberNumber
          stats(format: $format) {
            matchesWon
            matchesPlayed
            winPercentage
            defensiveShotAverage
            breakAndRuns
            nineOnTheSnap
            miniSlams
            shutouts
            pointsPerMatch
            pointsAwarded
            __typename
          }
          __typename
        }
      }
    `;
    
    const operations = memberIds.map(id => ({
      operationName: 'memberStats',
      query,
      variables: { id, format },
    }));
    
    const results = await this.graphql<GQLMemberStats>(operations);
    return results;
  }

  // Get player's match history (individual game results)
  async getPlayerMatchHistory(playerId: number): Promise<GQLPlayerMatchHistory> {
    const query = `
      query playerMatchHistory($id: Int!) {
        player(id: $id) {
          id
          displayName
          skillLevel
          memberNumber
          matchHistory {
            id
            datePlayed
            won
            skillLevel
            pointsAwarded
            pointsNeeded
            opponent {
              id
              displayName
              skillLevel
              __typename
            }
            match {
              id
              week
              startTime
              __typename
            }
            team {
              id
              name
              __typename
            }
            __typename
          }
          __typename
        }
      }
    `;
    return this.graphqlSingle('playerMatchHistory', query, { id: playerId });
  }

  // Get player's session history (stats from multiple sessions)
  async getPlayerSessionHistory(memberId: number, format: 'NINE' | 'EIGHT' = 'NINE'): Promise<GQLMemberSessionHistory> {
    const query = `
      query memberSessionHistory($id: Int!, $format: FormatType!) {
        member(id: $id) {
          id
          firstName
          lastName
          playerHistory(format: $format, limit: 4) {
            id
            skillLevel
            matchesPlayed
            matchesWon
            ppm
            pa
            session {
              id
              name
              year
              __typename
            }
            team {
              id
              name
              number
              __typename
            }
            __typename
          }
          __typename
        }
      }
    `;
    return this.graphqlSingle('memberSessionHistory', query, { id: memberId, format });
  }

  // Fetch multiple players' match histories in parallel
  async getMultiplePlayerHistories(playerIds: number[]): Promise<GQLPlayerMatchHistory[]> {
    const query = `
      query playerMatchHistory($id: Int!) {
        player(id: $id) {
          id
          displayName
          skillLevel
          matchHistory {
            id
            datePlayed
            won
            skillLevel
            pointsAwarded
            pointsNeeded
            opponent {
              id
              displayName
              skillLevel
              __typename
            }
            __typename
          }
          __typename
        }
      }
    `;
    
    const operations = playerIds.map(id => ({
      operationName: 'playerMatchHistory',
      query,
      variables: { id },
    }));
    
    const results = await this.graphql<GQLPlayerMatchHistory>(operations);
    return results;
  }

  // Fetch multiple team rosters in parallel
  async getMultipleTeamRosters(teamIds: number[]): Promise<GQLTeam[]> {
    const query = `
      query teamRoster($id: Int!) {
        team(id: $id) {
          id
          name
          number
          league { id slug __typename }
          division { id type __typename }
          roster {
            id
            memberNumber
            displayName
            matchesWon
            matchesPlayed
            skillLevel
            member { id __typename }
            alias { id __typename }
            __typename
            ... on NineBallPlayer {
              pa
              ppm
            }
            ... on EightBallPlayer {
              pa
              ppm
            }
          }
          __typename
        }
      }
    `;

    const operations = teamIds.map(id => ({
      operationName: 'teamRoster',
      query,
      variables: { id },
    }));
    
    const results = await this.graphql<{ team: GQLTeam }>(operations);
    return results.map(r => r.team);
  }

  // Test connection
  async testConnection(): Promise<boolean> {
    try {
      await this.getViewer();
      return true;
    } catch {
      return false;
    }
  }
}

// Export singleton instance
export const apaClient = new APAClient();
export default apaClient;
