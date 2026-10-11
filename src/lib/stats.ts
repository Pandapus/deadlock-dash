import { PlayerMatchOutcome, type MatchHistoryEntry } from "../api/types";

export interface WinLoss {
  games: number;
  wins: number;
}

export interface PlayerSummary extends WinLoss {
  /** Null when there are no scored (win/loss) games. */
  winRate: number | null;
  avgKda: number | null;
  topHeroes: (WinLoss & { heroId: number })[];
}

const isScored = (m: MatchHistoryEntry) =>
  m.player_match_outcome === PlayerMatchOutcome.Win ||
  m.player_match_outcome === PlayerMatchOutcome.Loss;

const isWin = (m: MatchHistoryEntry) => m.player_match_outcome === PlayerMatchOutcome.Win;

/** Summary over the most recent `limit` scored matches (history is newest-first). */
export function summarize(history: MatchHistoryEntry[], limit = 20): PlayerSummary {
  const recent = history.filter(isScored).slice(0, limit);
  const wins = recent.filter(isWin).length;
  const kdas = recent.map((m) => (m.player_kills + m.player_assists) / Math.max(1, m.player_deaths));

  const byHero = new Map<number, WinLoss>();
  for (const m of recent) {
    const r = byHero.get(m.hero_id) ?? { games: 0, wins: 0 };
    r.games += 1;
    if (isWin(m)) r.wins += 1;
    byHero.set(m.hero_id, r);
  }

  return {
    games: recent.length,
    wins,
    winRate: recent.length ? wins / recent.length : null,
    avgKda: kdas.length ? kdas.reduce((a, b) => a + b, 0) / kdas.length : null,
    topHeroes: [...byHero.entries()]
      .map(([heroId, r]) => ({ heroId, ...r }))
      .sort((a, b) => b.games - a.games)
      .slice(0, 3),
  };
}

/** All-history record on one hero. */
export function heroRecord(history: MatchHistoryEntry[], heroId: number): WinLoss {
  const games = history.filter((m) => m.hero_id === heroId && isScored(m));
  return { games: games.length, wins: games.filter(isWin).length };
}
