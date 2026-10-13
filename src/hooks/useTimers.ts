import type { LiveState, MatchReport } from "../api/native";
import { TIMER_KINDS, upcomingTimers, type TimerKind } from "../lib/timers";
import { useMatchClock } from "./useMatchClock";
import type { TimerPrefs } from "./useSettings";
import { useTimerAlerts } from "./useTimerAlerts";

/** How far ahead the panel lists timers. */
const HORIZON_SECS = 10 * 60;

export function isTimerOn(prefs: TimerPrefs, kind: TimerKind): boolean {
  return prefs.enabled[kind] ?? TIMER_KINDS.find((k) => k.id === kind)!.defaultOn;
}

/** Match clock plus upcoming timers, with voice warnings. Runs whichever tab is open. */
export function useTimers(report: MatchReport | null, live: LiveState | null, prefs: TimerPrefs) {
  const { clock, delay, offset, nudge } = useMatchClock(report, live);
  const feed = live && live.match_id === report?.match_id ? live : null;
  const timers =
    clock === null ? [] : upcomingTimers(clock, HORIZON_SECS, feed).filter((t) => isTimerOn(prefs, t.kind));
  useTimerAlerts(clock, timers, prefs.lead, prefs.voice);
  return { clock, delay, offset, nudge, timers, hasFeed: feed !== null };
}
