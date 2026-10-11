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
} as const;

export const detectEnvironment = () => invoke<Environment>("detect_environment");
export const startConsoleWatch = (path: string) => invoke<void>("start_console_watch", { path });
export const stopConsoleWatch = () => invoke<void>("stop_console_watch");
