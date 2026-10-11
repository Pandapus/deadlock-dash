import { useEffect, useState } from "react";
import { getMatchHistory } from "../api/client";
import { MATCH_MODE_LABELS, PlayerMatchOutcome, type MatchHistoryEntry } from "../api/types";
import type { HeroMap } from "../hooks/useHeroes";
import { formatDuration, formatKda, formatPercent, formatRelativeTime, formatSouls } from "../lib/format";
import { summarize } from "../lib/stats";
import { HeroBadge } from "./HeroBadge";

const SHOWN = 15;

export function RecentMatches({ accountId, heroes }: { accountId: number; heroes: HeroMap }) {
  const [history, setHistory] = useState<MatchHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHistory(null);
    setError(null);
    getMatchHistory(accountId)
      .then((h) => !cancelled && setHistory(h))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const summary = history ? summarize(history) : null;

  return (
    <section className="panel">
      <header className="panel__header">
        <h2>Recent matches</h2>
        {summary && summary.games > 0 && (
          <span className="muted">
            Last {summary.games}: {formatPercent(summary.winRate)} win rate · {summary.avgKda?.toFixed(1)} KDA
          </span>
        )}
      </header>
      {error && <p className="error">Couldn't load match history: {error}</p>}
      {!history && !error && <p className="muted">Loading…</p>}
      {history && history.length === 0 && (
        <p className="muted">
          No matches found. deadlock-api only has full history for accounts it has seen — see the README.
        </p>
      )}
      {history && history.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Result</th>
              <th>Hero</th>
              <th className="num">K / D / A</th>
              <th className="num">KDA</th>
              <th className="num">Souls</th>
              <th className="num">Length</th>
              <th>Mode</th>
              <th className="num">When</th>
            </tr>
          </thead>
          <tbody>
            {history.slice(0, SHOWN).map((m) => (
              <tr key={m.match_id}>
                <td>
                  <OutcomePill outcome={m.player_match_outcome} />
                </td>
                <td>
                  <HeroBadge heroId={m.hero_id} heroes={heroes} />
                </td>
                <td className="num">
                  {m.player_kills} / {m.player_deaths} / {m.player_assists}
                </td>
                <td className="num">{formatKda(m.player_kills, m.player_deaths, m.player_assists)}</td>
                <td className="num">{formatSouls(m.net_worth)}</td>
                <td className="num">{formatDuration(m.match_duration_s)}</td>
                <td className="muted">{MATCH_MODE_LABELS[m.match_mode] ?? m.match_mode}</td>
                <td className="num muted">{formatRelativeTime(m.start_time)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function OutcomePill({ outcome }: { outcome: number }) {
  if (outcome === PlayerMatchOutcome.Win) return <span className="pill pill--good">Win</span>;
  if (outcome === PlayerMatchOutcome.Loss) return <span className="pill pill--bad">Loss</span>;
  return <span className="pill">—</span>;
}
