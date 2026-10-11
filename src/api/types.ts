// Response shapes from https://api.deadlock-api.com (community API, not Valve).
// Only the fields this app uses are typed; see the API docs for the rest.

/** GET /v1/players/{account_id}/match-history */
export interface MatchHistoryEntry {
  account_id: number;
  match_id: number;
  hero_id: number;
  hero_level: number;
  start_time: number;
  game_mode: number;
  match_mode: number;
  player_team: number;
  player_kills: number;
  player_deaths: number;
  player_assists: number;
  denies: number;
  net_worth: number;
  last_hits: number;
  match_duration_s: number;
  match_result: number;
  /** See PlayerMatchOutcome. */
  player_match_outcome: number;
  ranked_display_badge?: number | null;
  ranked_delta?: number | null;
}

export const PlayerMatchOutcome = {
  Invalid: 0,
  Win: 1,
  Loss: 2,
  Penalized: 3,
  PenalizedParty: 4,
  NotScored: 5,
} as const;

/** GET /v1/matches/active — only covers the ~200 matches in the in-game Watch tab. */
export interface ActiveMatch {
  match_id?: number | null;
  start_time?: number | null;
  duration_s?: number | null;
  players: ActiveMatchPlayer[];
  net_worth_team_0?: number | null;
  net_worth_team_1?: number | null;
  spectators?: number | null;
  match_mode?: number | null;
  match_mode_parsed?: string | null;
  game_mode_parsed?: string | null;
  region_mode_parsed?: string | null;
  winning_team?: number | null;
}

export interface ActiveMatchPlayer {
  account_id?: number | null;
  team?: number | null;
  abandoned?: boolean | null;
  hero_id?: number | null;
}

/** GET /v1/assets/heroes */
export interface Hero {
  id: number;
  name: string;
  images: {
    icon_image_small?: string;
    icon_image_small_webp?: string;
    icon_hero_card?: string;
    minimap_image?: string;
  };
}

/** GET /v1/players/steam-search and /v1/players/steam */
export interface SteamProfile {
  account_id: number;
  personaname: string;
  avatar: string;
  avatarmedium: string;
  profileurl: string;
}

/** Index = raw `match_mode` value. */
export const MATCH_MODE_LABELS = [
  "Invalid",
  "Unranked",
  "Private Lobby",
  "Co-op Bots",
  "Ranked",
  "Server Test",
  "Tutorial",
  "Hero Labs",
  "Placement",
];
