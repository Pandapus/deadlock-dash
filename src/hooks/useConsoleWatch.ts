import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  ConsoleEvents,
  startConsoleWatch,
  stopConsoleWatch,
  type ConsoleLines,
  type ConsoleStatus,
  type GameEvent,
  type MatchReport,
} from "../api/native";

const MAX_LINES = 1000;

/** What the console log says the game is doing. */
export interface GameState {
  phase: "unknown" | "menus" | "in_game";
  map: string | null;
  matchId: number | null;
}

const INITIAL_GAME: GameState = { phase: "unknown", map: null, matchId: null };

function applyEvent(state: GameState, event: GameEvent): GameState {
  switch (event.kind) {
    case "map_loaded":
      return { ...state, phase: "in_game", map: event.map };
    case "server_connected":
      return { ...state, phase: "in_game" };
    case "disconnected":
      return { phase: "menus", map: null, matchId: null };
    case "match_id":
      return { ...state, matchId: event.match_id };
  }
}

/** `accountId` is who the console reports get saved under. */
export function useConsoleWatch(path: string | null, accountId: number | null) {
  const [status, setStatus] = useState<ConsoleStatus | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [game, setGame] = useState<GameState>(INITIAL_GAME);
  const [report, setReport] = useState<MatchReport | null>(null);

  useEffect(() => {
    if (!path) return;
    setStatus(null);
    setLines([]);
    setGame(INITIAL_GAME);
    setReport(null);

    const unlisten = Promise.all([
      listen<ConsoleStatus>(ConsoleEvents.status, (e) => setStatus(e.payload)),
      listen<MatchReport | null>(ConsoleEvents.match, (e) => setReport(e.payload)),
      listen<GameEvent>(ConsoleEvents.game, (e) => setGame((g) => applyEvent(g, e.payload))),
      listen<ConsoleLines>(ConsoleEvents.lines, ({ payload }) => {
        if (payload.reset) setGame(INITIAL_GAME);
        setLines((prev) => (payload.reset ? payload.lines : [...prev, ...payload.lines]).slice(-MAX_LINES));
      }),
    ]);
    // Start only once listeners are attached so the initial backlog isn't missed.
    unlisten.then(() => startConsoleWatch(path, accountId)).catch((e) => console.error(e));

    return () => {
      stopConsoleWatch().catch(() => {});
      unlisten.then((fns) => fns.forEach((fn) => fn()));
    };
  }, [path, accountId]);

  return { status, lines, game, report };
}
