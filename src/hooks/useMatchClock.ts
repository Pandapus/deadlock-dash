import { useEffect, useState } from "react";
import type { LiveState, MatchReport } from "../api/native";
import { parseLogStamp } from "../lib/timers";

const TICK_MS = 250;

/**
 * The real match clock, which the spectator broadcast can't give: it runs
 * behind the game. The console log records when the game went live (clock
 * 0:00) with no delay, so the clock is the time since then, less any pauses
 * the broadcast has reported.
 *
 * The log only has whole seconds, and a pause only counts once the delayed
 * broadcast shows it, so `nudge` lets the player correct the clock by hand.
 */
export function useMatchClock(report: MatchReport | null, live: LiveState | null) {
  const [now, setNow] = useState(Date.now);
  const [offset, setOffset] = useState(0);
  const matchId = report?.match_id ?? null;
  const running = report?.phase === "in_progress" && report.started_at != null;

  useEffect(() => setOffset(0), [matchId]);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [running]);

  const startMs = running ? parseLogStamp(report.started_at) : null;
  const feed = live && live.match_id === matchId ? live : null;
  const clock = startMs != null ? (now - startMs) / 1000 - (feed?.paused_secs ?? 0) + offset : null;
  // How far behind the broadcast is: useful to know which of its timers can still arrive in time.
  const delay =
    clock != null && feed?.status === "live" && feed.clock != null && !feed.paused ? clock - feed.clock : null;

  return { clock, delay, offset, nudge: (secs: number) => setOffset((o) => o + secs) };
}
