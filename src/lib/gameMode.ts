import type { LiveState } from "../api/native";

export type GameMode = "standard" | "street_brawl" | "unknown";

/**
 * Which ruleset a match is played under.
 *
 * The console log's map name is the earliest signal: Street Brawl loads
 * `street_*` maps (seen as `street_test` in a real log). The broadcast's
 * Street Brawl round and scores back it up once a round has been played,
 * which covers matches without a console log (e.g. spectating).
 */
export function detectGameMode(map: string | null | undefined, live: LiveState | null): GameMode {
  if (map?.startsWith("street")) return "street_brawl";
  if (live && (live.round > 0 || live.amber_score > 0 || live.sapphire_score > 0)) return "street_brawl";
  return map ? "standard" : "unknown";
}
