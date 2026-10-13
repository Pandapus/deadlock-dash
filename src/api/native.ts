import { invoke } from "@tauri-apps/api/core";

/** Mirrors `steam::Environment` in src-tauri/src/steam.rs. */
export interface Environment {
  steam_root: string | null;
  deadlock_dir: string | null;
  console_log_path: string | null;
  console_log_exists: boolean;
  account: { account_id: number; steam_id64: string; persona_name: string | null } | null;
}

/** Mirrors `console_log::GameEvent`. */
export type GameEvent =
  | { kind: "map_loaded"; map: string }
  | { kind: "server_connected"; address: string }
  | { kind: "disconnected"; reason: string }
  | { kind: "match_id"; match_id: number };

/** Mirrors `match_report::MatchReport`. Hero values are codenames (`hero_<codename>`). */
export interface MatchReport {
  match_id: number;
  lobby_id: number;
  build: number | null;
  map: string | null;
  phase: "loading" | "intro" | "in_progress" | "post_game" | "ended";
  players: number | null;
  found_at: string;
  queue_secs: number | null;
  load_secs: number | null;
  /** When the game went live (clock 0:00), as the log's local `MM/DD HH:MM:SS`. */
  started_at: string | null;
  duration_secs: number | null;
  left_early: boolean;
  my_hero: string | null;
  roster: string[];
  deaths: { at: string; match_time: number; respawn_secs: number | null; spectated: string | null }[];
  hit_reg: { lost: HitCounts; gained: HitCounts; swapped: number };
  network: {
    relay: string | null;
    relay_ping: number | null;
    ping_p50: number | null;
    ping_p95: number | null;
    jitter_p99: number | null;
    ticks_on_time_pct: number | null;
    quality_pct: number | null;
    dropped_pct: number | null;
    tick_resyncs: number;
    nearest_relays: [string, number][];
  };
  performance: {
    fps_avg: number | null;
    fps_p1: number | null;
    shadow_overflows: number;
    scene_limit_hits: number;
  };
}

export interface HitCounts {
  hero: number;
  trooper: number;
  objective: number;
  other: number;
}

/** Mirrors `live::LiveState`. Teams: 2 = Amber, 3 = Sapphire. */
export interface LiveState {
  match_id: number;
  status: "resolving" | "waiting" | "live" | "ended" | "error";
  message: string | null;
  tick: number;
  clock: number | null;
  paused: boolean;
  round: number;
  amber_score: number;
  sapphire_score: number;
  winning_team: number | null;
  players: LivePlayer[];
  kills: { tick: number; clock: number | null; victim: number | null; attacker: number | null; assisters: number[]; souls: number }[];
  souls_history: { clock: number; amber: number; sapphire: number }[];
  /** Seconds paused, as far as the broadcast has seen. */
  paused_secs: number;
  mid_boss_kills: number;
  /** Match clock at which the Mid Boss respawns; null while it's alive. */
  mid_boss_respawn: number | null;
  /** Neutral camp respawns, as on the in-game minimap. */
  camps: { kind: "small" | "medium" | "large" | null; respawn_at: number }[];
}

export interface LivePlayer {
  slot: number;
  name: string;
  account_id: number | null;
  team: number;
  hero_id: number;
  level: number;
  net_worth: number;
  kills: number;
  deaths: number;
  assists: number;
  last_hits: number;
  denies: number;
  hero_damage: number;
  healing: number;
  objective_damage: number;
  alive: boolean;
  kill_streak: number;
  abandoned: boolean;
  items: number[];
}

export interface ConsoleLines {
  lines: string[];
  reset: boolean;
}

export interface ConsoleStatus {
  path: string;
  state: "waiting" | "watching" | "error";
  message: string | null;
}

export const ConsoleEvents = {
  lines: "console://lines",
  game: "console://game-event",
  status: "console://status",
  match: "console://match-report",
} as const;

export const LIVE_EVENT = "live://state";

export const startLiveFeed = (matchId: number) => invoke<void>("start_live_feed", { matchId });
export const stopLiveFeed = () => invoke<void>("stop_live_feed");

export const detectEnvironment = () => invoke<Environment>("detect_environment");
export const startConsoleWatch = (path: string, accountId: number | null) =>
  invoke<void>("start_console_watch", { path, accountId });
export const stopConsoleWatch = () => invoke<void>("stop_console_watch");

/** Mirrors `db::Status`. */
export interface DbStatus {
  path: string | null;
  /** Set when the database file couldn't be opened; nothing is saved then. */
  error: string | null;
  install_id: string;
  contribute: boolean;
  matches: number;
  players: number;
}

/** Mirrors `db::Totals`. Stat sums cover `with_stats` matches; wins/losses only decided ones. */
export interface Totals {
  matches: number;
  wins: number;
  losses: number;
  with_stats: number;
  kills: number;
  deaths: number;
  assists: number;
  avg_net_worth: number | null;
  seconds_played: number;
}

/** Mirrors `db::PlayedMatch`. Teams: 0 = Amber, 1 = Sapphire. */
export interface PlayedMatch {
  match_id: number;
  start_time: number | null;
  duration_s: number | null;
  game_mode: number | null;
  match_mode: number | null;
  team: number | null;
  won: boolean | null;
  hero_id: number | null;
  /** Hero codename from your console report, when `hero_id` is unknown. */
  report_hero: string | null;
  level: number | null;
  net_worth: number | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  last_hits: number | null;
  hero_damage: number | null;
  abandoned: boolean | null;
  has_report: boolean;
  source: "console" | "live" | "history";
}

/** Mirrors `db::Encounter`. */
export interface Encounter {
  account_id: number;
  persona_name: string | null;
  matches: number;
  with_wins: number;
  with_losses: number;
  with_matches: number;
  against_wins: number;
  against_losses: number;
  against_matches: number;
  last_played: number | null;
  /** Times the profile player killed them, and they the profile player. */
  killed: number;
  killed_by: number;
}

/** Mirrors `db::Profile`. */
export interface Profile {
  player: { account_id: number; persona_name: string | null; first_seen_at: number | null; last_seen_at: number | null };
  totals: Totals;
  heroes: (Totals & { hero_id: number })[];
  matches: PlayedMatch[];
  encounters: Encounter[];
}

/** Fired whenever new matches are saved locally. */
export const DB_CHANGED_EVENT = "db://changed";

export const playerProfile = (accountId: number, limit?: number) =>
  invoke<Profile>("player_profile", { accountId, limit });
export const dbStatus = () => invoke<DbStatus>("db_status");
export const setContribute = (contribute: boolean) => invoke<void>("set_contribute", { contribute });
