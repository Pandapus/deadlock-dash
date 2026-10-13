import { useState } from "react";
import type { MatchPlayer } from "../api/native";
import type { HeroMap } from "../hooks/useHeroes";
import { formatSouls } from "../lib/format";
import { HeroBadge } from "./HeroBadge";
import type { TeamLabels } from "./NetWorthChart";

type NumericKey = {
  [K in keyof MatchPlayer]: MatchPlayer[K] extends number | null ? K : never;
}[keyof MatchPlayer];

export interface Metric {
  key: Exclude<NumericKey, "account_id" | "team" | "hero_id">;
  label: string;
  format: (v: number) => string;
}

const count = (v: number) => v.toLocaleString("en-US");

export const METRICS: Metric[] = [
  { key: "net_worth", label: "Souls", format: formatSouls },
  { key: "hero_damage", label: "Hero damage", format: formatSouls },
  { key: "objective_damage", label: "Objective damage", format: formatSouls },
  { key: "healing", label: "Healing", format: formatSouls },
  { key: "kills", label: "Kills", format: count },
  { key: "deaths", label: "Deaths", format: count },
  { key: "assists", label: "Assists", format: count },
  { key: "last_hits", label: "Last hits", format: count },
  { key: "denies", label: "Denies", format: count },
];

/** Per-player hero, as the page resolved it (stored id, or your console report's hero). */
export type HeroOf = (p: MatchPlayer) => number | null | undefined;

interface Common {
  players: MatchPlayer[];
  myTeam: number;
  labels: TeamLabels;
}

/**
 * Team totals as one split bar per stat. A stat only shows when every player
 * on both teams has it, so the split is never skewed by missing rows.
 */
export function TeamComparison({ players, myTeam, labels }: Common) {
  const ally = players.filter((p) => p.team === myTeam);
  const enemy = players.filter((p) => p.team != null && p.team !== myTeam);
  if (ally.length === 0 || enemy.length === 0) return null;
  const rows = METRICS.filter((m) => m.key !== "denies")
    .map((m) => {
      const complete = (team: MatchPlayer[]) => team.every((p) => p[m.key] != null);
      if (!complete(ally) || !complete(enemy)) return null;
      const sum = (team: MatchPlayer[]) => team.reduce((s, p) => s + (p[m.key] ?? 0), 0);
      return { m, a: sum(ally), e: sum(enemy) };
    })
    .filter((r) => r !== null && r.a + r.e > 0) as { m: Metric; a: number; e: number }[];
  if (rows.length === 0) return null;

  return (
    <div className="split-bars">
      <span />
      <span className="split-bars__team split-bars__team--left">
        <i className="swatch swatch--ally" /> {labels.ally}
      </span>
      <span />
      <span className="split-bars__team">
        {labels.enemy} <i className="swatch swatch--enemy" />
      </span>
      {rows.map(({ m, a, e }) => {
        const share = a / (a + e);
        return (
          <div key={m.key} className="split-bars__row" title={`${m.label}: ${m.format(a)} vs ${m.format(e)}`}>
            <span className="split-bars__label">{m.label}</span>
            <span className="split-bars__value split-bars__value--left">{m.format(a)}</span>
            <span className="split-bars__track" aria-hidden>
              <span className="split-bars__fill split-bars__fill--ally" style={{ flexGrow: share }} />
              <span className="split-bars__fill split-bars__fill--enemy" style={{ flexGrow: 1 - share }} />
              <span className="split-bars__mid" />
            </span>
            <span className="split-bars__value">{m.format(e)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Every player ranked on one stat, coloured by team. */
export function PlayerBars({
  players,
  myTeam,
  labels,
  heroes,
  heroOf,
  focusId,
  onOpenPlayer,
}: Common & { heroes: HeroMap; heroOf: HeroOf; focusId: number; onOpenPlayer: (accountId: number) => void }) {
  // Stats at least two players have; one bar isn't a comparison.
  const available = METRICS.filter((m) => players.filter((p) => p[m.key] != null).length >= 2);
  const [key, setKey] = useState<Metric["key"]>(available[0]?.key ?? "net_worth");
  const metric = available.find((m) => m.key === key) ?? available[0];
  if (!metric) return null;

  const rows = players
    .filter((p) => p[metric.key] != null)
    .sort((a, b) => (b[metric.key] ?? 0) - (a[metric.key] ?? 0));
  const max = Math.max(1, ...rows.map((p) => p[metric.key] ?? 0));

  return (
    <>
      <div className="segmented" role="tablist" aria-label="Stat">
        {available.map((m) => (
          <button
            key={m.key}
            role="tab"
            aria-selected={m.key === metric.key}
            className={`tab ${m.key === metric.key ? "tab--active" : ""}`}
            onClick={() => setKey(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="chart__legend">
        <span>
          <i className="swatch swatch--ally" /> {labels.ally}
        </span>
        <span>
          <i className="swatch swatch--enemy" /> {labels.enemy}
        </span>
      </div>
      <ol className="player-bars" aria-label={`${metric.label} by player`}>
        {rows.map((p) => {
          const value = p[metric.key] ?? 0;
          const side = p.team === myTeam ? "ally" : "enemy";
          return (
            <li
              key={p.account_id}
              className={`player-bars__row ${p.account_id === focusId ? "player-bars__row--focus" : ""}`}
              title={`${p.persona_name ?? `Player ${p.account_id}`}: ${metric.format(value)} ${metric.label.toLowerCase()}`}
            >
              <span className="player-bars__who">
                <HeroBadge heroId={heroOf(p)} heroes={heroes} compact />
                <button className="link player-bars__name" onClick={() => onOpenPlayer(p.account_id)}>
                  {p.persona_name ?? `Player ${p.account_id}`}
                </button>
              </span>
              <span className="player-bars__track">
                <span
                  className={`player-bars__fill player-bars__fill--${side}`}
                  style={{ width: `${(value / max) * 100}%` }}
                />
              </span>
              <span className="player-bars__value">{metric.format(value)}</span>
            </li>
          );
        })}
      </ol>
    </>
  );
}
