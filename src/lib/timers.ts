import type { LiveState } from "../api/native";

/**
 * Spawn timers on the match clock (seconds since 0:00).
 *
 * The spectator broadcast runs behind the real game, so the clock comes from
 * console.log instead (see useMatchClock). Two kinds of timers:
 *
 * - **Schedule**: known before the match. `verified` ones were checked
 *   against game data from real demos (build 6774, October 2026); the rest
 *   come from community guides and may be off after a patch.
 * - **Broadcast**: respawns the game itself tracks (Mid Boss, cleared camps),
 *   read from the delayed broadcast. They're absolute times, so they still
 *   land correctly as long as they haven't already passed.
 */

export type TimerKind = "camps" | "boxes" | "powerups" | "mid_boss" | "rift" | "troopers";

export const TIMER_KINDS: { id: TimerKind; label: string; defaultOn: boolean }[] = [
  { id: "camps", label: "Camps", defaultOn: true },
  { id: "boxes", label: "Boxes & statues", defaultOn: true },
  { id: "powerups", label: "Bridge buffs", defaultOn: true },
  { id: "mid_boss", label: "Mid Boss", defaultOn: true },
  { id: "rift", label: "Unstable Rift", defaultOn: true },
  { id: "troopers", label: "Trooper waves", defaultOn: false },
];

export interface TimerEvent {
  key: string;
  kind: TimerKind;
  label: string;
  /** Match clock, seconds. */
  at: number;
  /** ± seconds when the game randomises the time. */
  approx?: number;
  /** Checked against game data rather than taken from guides. */
  verified: boolean;
}

interface FixedSpawn {
  kind: TimerKind;
  label: string;
  at: number;
  approx?: number;
  verified: boolean;
}

const FIXED: FixedSpawn[] = [
  // Camp first spawns are in the broadcast's own camp timer list.
  { kind: "camps", label: "Small camps", at: 120, verified: true },
  { kind: "camps", label: "Medium camps", at: 300, verified: true },
  { kind: "camps", label: "Large camps and Sinner's Sacrifice", at: 480, verified: true },
  { kind: "boxes", label: "Boxes and golden statues", at: 120, verified: false },
  // Unstable Rift start varies by about a minute. Seen at 12:46 and 13:03,
  // 19:23 and 19:39, and 25:28 in two demos.
  { kind: "rift", label: "Unstable Rift", at: 780, approx: 60, verified: false },
  { kind: "rift", label: "Unstable Rift", at: 1170, approx: 60, verified: false },
  { kind: "rift", label: "Unstable Rift", at: 1530, approx: 60, verified: false },
];

/** Bridge buff: 5:00, then every 5:00. */
const POWERUP_FIRST = 300;
const POWERUP_EVERY = 300;

/** Trooper wave interval at a given clock: 30 s, 25 s from 20:00, 20 s from 35:00. */
function waveInterval(clock: number): number {
  return clock < 1200 ? 30 : clock < 2100 ? 25 : 20;
}

const CAMP_LABELS = { small: "Small camp", medium: "Medium camp", large: "Large camp", unknown: "Camp" };
const CAMP_GROUP_SECS = 3;

/** Timers due after `from` and up to `from + horizon`, soonest first. */
export function upcomingTimers(from: number, horizon: number, live: LiveState | null): TimerEvent[] {
  const to = from + horizon;
  const out: TimerEvent[] = [];
  const inWindow = (at: number, approx = 0) => at + approx > from && at - approx <= to;

  FIXED.forEach((s, i) => {
    if (inWindow(s.at, s.approx)) out.push({ key: `fixed:${i}`, ...s });
  });

  for (let at = POWERUP_FIRST; at <= to; at += POWERUP_EVERY) {
    if (inWindow(at)) out.push({ key: `powerup:${at}`, kind: "powerups", label: "Bridge buff", at, verified: false });
  }

  for (let at = 0; at <= to; at += waveInterval(at)) {
    if (inWindow(at)) out.push({ key: `wave:${at}`, kind: "troopers", label: "Trooper wave", at, verified: false });
  }

  if (live?.mid_boss_respawn != null && inWindow(live.mid_boss_respawn)) {
    out.push({
      key: `midboss:${live.mid_boss_kills}`,
      kind: "mid_boss",
      label: "Mid Boss",
      at: live.mid_boss_respawn,
      verified: true,
    });
  }

  // Camps of a kind cleared moments apart respawn together: one timer.
  const groups: { kind: keyof typeof CAMP_LABELS; at: number; count: number }[] = [];
  const camps = (live?.camps ?? []).filter((c) => inWindow(c.respawn_at)).sort((a, b) => a.respawn_at - b.respawn_at);
  for (const c of camps) {
    const kind = c.kind ?? "unknown";
    const group = groups.find((g) => g.kind === kind && c.respawn_at - g.at <= CAMP_GROUP_SECS);
    if (group) group.count += 1;
    else groups.push({ kind, at: c.respawn_at, count: 1 });
  }
  for (const g of groups) {
    const label = CAMP_LABELS[g.kind];
    out.push({
      key: `camp:${g.kind}:${Math.round(g.at)}`,
      kind: "camps",
      label: g.count > 1 ? `${g.count} ${label.toLowerCase()}s` : label,
      at: g.at,
      verified: true,
    });
  }

  return out.sort((a, b) => a.at - b.at);
}

/** Parses console.log's local `MM/DD HH:MM:SS` (no year) to epoch ms. */
export function parseLogStamp(stamp: string | null | undefined, now = new Date()): number | null {
  const m = stamp?.match(/^(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [month, day, h, min, s] = m.slice(1).map(Number);
  const at = new Date(now.getFullYear(), month - 1, day, h, min, s);
  // A December log read in January.
  if (at.getTime() - now.getTime() > 86_400_000) at.setFullYear(at.getFullYear() - 1);
  return at.getTime();
}
