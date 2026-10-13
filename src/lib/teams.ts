/**
 * Deadlock's two teams. The API calls them Amber and Sapphire; in game they're
 * the Hidden King (yellow/orange) and the Archmother (blue).
 */
export type TeamKey = "hidden-king" | "archmother";

/** Stored match data (db / active-match feed): 0 = Hidden King, 1 = Archmother. */
export const TEAM_BY_INDEX: TeamKey[] = ["hidden-king", "archmother"];
/** Live broadcast: 2 = Hidden King, 3 = Archmother. */
export const TEAM_BY_LIVE_ID: Record<number, TeamKey> = { 2: "hidden-king", 3: "archmother" };

export const TEAM_NAMES: Record<TeamKey, string> = {
  "hidden-king": "Hidden King",
  archmother: "Archmother",
};

/**
 * Wrapper class that paints `--ally`/`--enemy` in the real team colours,
 * with `team` as the ally side.
 */
export function sidesClass(team: TeamKey | undefined): string {
  return `sides--${team ?? "archmother"}`;
}
