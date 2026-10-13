import { useMemo, useState } from "react";
import { useHeroRoster } from "../hooks/useHeroData";
import type { ItemMap } from "../hooks/useItems";
import { formatNumber } from "../lib/abilities";
import { formatPercent } from "../lib/format";
import { ROLE_LABELS, statsAt, type HeroMeta, type HeroProfile, type Weapon } from "../lib/heroStats";
import { MetaScatter } from "./HeroCharts";
import { Complexity, HeroDetail } from "./HeroDetail";

interface SortDef {
  id: string;
  label: string;
  /** null = no data for this hero; sorted last and shown without a bar. */
  value: (h: HeroProfile, w: Weapon | undefined, m: HeroMeta | undefined) => number | null;
  format: (v: number) => string;
  /** Bars grow left/right from this value instead of from zero (win rate around 50%). */
  center?: number;
}

const SORTS: SortDef[] = [
  { id: "name", label: "Name", value: () => null, format: () => "" },
  { id: "win", label: "Win rate", value: (_h, _w, m) => m?.winRate ?? null, format: (v) => formatPercent(v), center: 0.5 },
  { id: "pick", label: "Pick rate", value: (_h, _w, m) => m?.pickRate ?? null, format: (v) => formatPercent(v) },
  { id: "health", label: "Health", value: (h) => h.base.maxHealth, format: (v) => String(Math.round(v)) },
  { id: "dps", label: "Gun DPS", value: (h, w) => (w ? statsAt(h, w, 0).dps : null), format: (v) => formatNumber(v) },
  { id: "speed", label: "Move speed", value: (h) => h.base.moveSpeed, format: (v) => `${formatNumber(v)} m/s` },
  { id: "complexity", label: "Complexity", value: (h) => h.complexity ?? null, format: (v) => String(v) },
];

/** The roster, a meta overview, and each hero's full page. */
export function HeroesPage({ items }: { items: ItemMap }) {
  const roster = useHeroRoster();
  const [selected, setSelected] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<string | null>(null);
  const [sortId, setSortId] = useState("name");

  const open = (id: number | null) => {
    setSelected(id);
    window.scrollTo(0, 0);
  };

  const sort = SORTS.find((s) => s.id === sortId) ?? SORTS[0];
  const roles = useMemo(() => [...new Set(roster.heroes.map((h) => h.role).filter((r): r is string => !!r))].sort(), [roster.heroes]);

  const cards = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = roster.heroes
      .filter((h) => (!role || h.role === role) && (!needle || h.name.toLowerCase().includes(needle)))
      .map((h) => ({ hero: h, value: sort.value(h, h.weaponClass ? roster.weapons.get(h.weaponClass) : undefined, roster.meta.get(h.id)) }));
    if (sort.id !== "name") rows.sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
    return rows;
  }, [roster, query, role, sort]);
  const center = sort.center;
  const max = Math.max(0, ...cards.map((c) => (c.value === null ? 0 : center !== undefined ? Math.abs(c.value - center) : c.value)));
  const barStyle = (value: number | null) => {
    if (value === null || max === 0) return { width: 0 };
    if (center === undefined) return { width: `${(value / max) * 100}%` };
    const half = (Math.abs(value - center) / max) * 50;
    return { left: `${value >= center ? 50 : 50 - half}%`, width: `${half}%` };
  };

  const hero = selected !== null ? roster.heroes.find((h) => h.id === selected) : undefined;
  if (hero) {
    return <HeroDetail key={hero.id} hero={hero} roster={roster} items={items} onBack={() => open(null)} onSelect={open} />;
  }

  return (
    <>
      <section className="panel panel--wide">
        <header className="panel__header">
          <h2>Heroes</h2>
          <input className="input input--small" placeholder="Filter by name" value={query} onChange={(e) => setQuery(e.target.value)} />
        </header>
        <div className="roster-controls">
          <div className="segmented" role="radiogroup" aria-label="Role">
            {[null, ...roles].map((r) => (
              <button key={r ?? "all"} role="radio" aria-checked={role === r} className={`tab ${role === r ? "tab--active" : ""}`} onClick={() => setRole(r)}>
                {r ? (ROLE_LABELS[r] ?? r) : "All"}
              </button>
            ))}
          </div>
          <label className="roster-controls__sort">
            <span className="muted">Sort by</span>
            <select className="input input--small" value={sortId} onChange={(e) => setSortId(e.target.value)}>
              {SORTS.map((s) => (
                <option key={s.id} value={s.id} disabled={(s.id === "win" || s.id === "pick") && roster.meta.size === 0}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {roster.loading && <p className="muted">Loading…</p>}
        {roster.error && <p className="error">{roster.error}</p>}
        <ul className="roster">
          {cards.map(({ hero: h, value }) => (
            <li key={h.id}>
              <button className="roster__card" onClick={() => open(h.id)} style={h.color ? { ["--hero" as string]: h.color } : undefined}>
                <span className="roster__portrait">{h.card && <img src={h.card} alt="" loading="lazy" />}</span>
                <span className="roster__name">{h.name}</span>
                <span className="roster__sub muted">
                  {h.role ? (ROLE_LABELS[h.role] ?? h.role) : ""}
                  {h.complexity !== undefined && <Complexity value={h.complexity} />}
                </span>
                {sort.id !== "name" && (
                  <span className="roster__metric">
                    <span className={`roster__bar ${center !== undefined ? "roster__bar--centered" : ""}`} aria-hidden>
                      <span style={barStyle(value)} />
                    </span>
                    <span className="roster__value">{value !== null ? sort.format(value) : "–"}</span>
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
        {!roster.loading && cards.length === 0 && <p className="muted">No heroes match.</p>}
      </section>

      {roster.meta.size > 0 && (
        <section className="panel panel--wide">
          <header className="panel__header">
            <h2>Meta</h2>
            <span className="muted">Win rate vs. pick rate · last 7 days, all ranks</span>
          </header>
          <MetaScatter heroes={roster.heroes} meta={roster.meta} onSelect={open} />
        </section>
      )}
    </>
  );
}
