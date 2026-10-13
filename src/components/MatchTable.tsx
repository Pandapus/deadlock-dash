import type { PlayedMatch } from "../api/native";
import { MATCH_MODE_LABELS } from "../api/types";
import type { HeroMap } from "../hooks/useHeroes";
import { formatDuration, formatKda, formatRelativeTime, formatSouls } from "../lib/format";
import { heroByCodename } from "../lib/matchInsights";
import { HeroBadge } from "./HeroBadge";

export const SOURCES: Record<PlayedMatch["source"], { label: string; title: string }> = {
  history: { label: "API", title: "Match history from deadlock-api" },
  live: { label: "Live", title: "Recorded from the live broadcast" },
  console: { label: "Log", title: "Only in your console.log: no result or scoreboard" },
};

/** Matches from the local database, newest first. Rows open the match when `onOpen` is set. */
export function MatchTable({
  matches,
  heroes,
  onOpen,
}: {
  matches: PlayedMatch[];
  heroes: HeroMap;
  onOpen?: (matchId: number) => void;
}) {
  return (
    <table className={`table ${onOpen ? "table--clickable" : ""}`}>
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
          <th>Data</th>
        </tr>
      </thead>
      <tbody>
        {matches.map((m) => {
          const hasStats = m.kills != null && m.deaths != null && m.assists != null;
          const source = SOURCES[m.source];
          return (
            <tr
              key={m.match_id}
              className={m.abandoned ? "abandoned" : undefined}
              tabIndex={onOpen ? 0 : undefined}
              title={onOpen ? `Open match ${m.match_id}` : undefined}
              onClick={onOpen && (() => onOpen(m.match_id))}
              onKeyDown={
                onOpen &&
                ((e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen(m.match_id);
                  }
                })
              }
            >
              <td>
                <ResultPill won={m.won} />
              </td>
              <td>
                <HeroBadge heroId={m.hero_id ?? heroByCodename(heroes, m.report_hero)?.id} heroes={heroes} />
              </td>
              <td className="num">{hasStats ? `${m.kills} / ${m.deaths} / ${m.assists}` : "–"}</td>
              <td className="num">{hasStats ? formatKda(m.kills!, m.deaths!, m.assists!) : "–"}</td>
              <td className="num">{m.net_worth != null ? formatSouls(m.net_worth) : "–"}</td>
              <td className="num">{m.duration_s != null ? formatDuration(m.duration_s) : "–"}</td>
              <td className="muted">{m.match_mode != null ? MATCH_MODE_LABELS[m.match_mode] ?? m.match_mode : "–"}</td>
              <td className="num muted">{m.start_time != null ? formatRelativeTime(m.start_time) : "–"}</td>
              <td className="muted" title={source.title}>
                {source.label}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function ResultPill({ won }: { won: boolean | null }) {
  if (won === true) return <span className="pill pill--good">Win</span>;
  if (won === false) return <span className="pill pill--bad">Loss</span>;
  return <span className="pill">—</span>;
}
