import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { LIVE_EVENT, startLiveFeed, stopLiveFeed, type LiveState, type MatchReport } from "../api/native";

/**
 * Streams the live scoreboard for the match the console log says you're in.
 *
 * Starts once per match while it's in progress and keeps running until the
 * broadcast ends (it runs behind the real game), so the final scoreboard stays
 * visible afterwards. Not started for matches that already ended: resolving a
 * broadcast is rate-limited.
 */
export function useLiveFeed(report: MatchReport | null) {
  const [state, setState] = useState<LiveState | null>(null);
  const startedFor = useRef<number | null>(null);

  useEffect(() => {
    // A replaced feed sends one last update for its old match; ignore it.
    const unlisten = listen<LiveState>(LIVE_EVENT, (e) => {
      if (e.payload.match_id === startedFor.current) setState(e.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
      stopLiveFeed().catch(() => {});
    };
  }, []);

  const matchId = report?.match_id ?? null;
  const live = report != null && report.phase !== "ended";
  useEffect(() => {
    if (matchId === null || !live || startedFor.current === matchId) return;
    startedFor.current = matchId;
    setState(null);
    startLiveFeed(matchId).catch((e) => console.error("Live feed failed to start", e));
  }, [matchId, live]);

  const stop = () => {
    stopLiveFeed().catch(() => {});
  };

  return { live: state, stop };
}
