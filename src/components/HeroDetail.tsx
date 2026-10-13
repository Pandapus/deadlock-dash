import { useMemo, useState } from "react";
import { useHeroAbilities, type HeroRoster } from "../hooks/useHeroData";
import type { ItemMap } from "../hooks/useItems";
import { formatNumber } from "../lib/abilities";
import { formatPercent, formatSouls } from "../lib/format";
import { ROLE_LABELS, statsAt, type HeroProfile, type ScaledStats, type Weapon } from "../lib/heroStats";
import { AbilityCard } from "./AbilityCard";
import { FalloffChart, RangeStrip, ScalingChart, type ScalingPoint } from "./HeroCharts";
import { ItemIcon } from "./ItemTooltip";

interface Ctx {
  hero: HeroProfile;
  weapon?: Weapon;
  s: ScaledStats;
}

interface StatDef {
  label: string;
  value: (c: Ctx) => number | null;
  format: (v: number) => string;
  /** Per-boon growth, shown next to the value. */
  perBoon?: (h: HeroProfile) => string | null;
  lowerIsBetter?: boolean;
  /** Hide the row for heroes where it's always the default. */
  show?: (h: HeroProfile) => boolean;
}

const int = (v: number) => Math.round(v).toLocaleString("en-US");
const dec = (unit = "") => (v: number) => `${formatNumber(v)}${unit}`;
const plus = (v: number, unit = "") => (v ? `+${formatNumber(v)}${unit}` : null);

const STAT_GROUPS: { title: string; slot: string; stats: StatDef[] }[] = [
  {
    title: "Vitality",
    slot: "vitality",
    stats: [
      { label: "Max health", value: (c) => c.s.health, format: int, perBoon: (h) => plus(h.perBoon.health) },
      { label: "Health regen", value: (c) => c.hero.base.healthRegen, format: dec("/s") },
      {
        label: "Bullet resist",
        value: (c) => c.s.bulletResist,
        format: dec("%"),
        perBoon: (h) => plus(h.perBoon.bulletResist, "%"),
        show: (h) => h.perBoon.bulletResist !== 0,
      },
      {
        label: "Spirit resist",
        value: (c) => c.s.spiritResist,
        format: dec("%"),
        perBoon: (h) => plus(h.perBoon.spiritResist, "%"),
        show: (h) => h.perBoon.spiritResist !== 0,
      },
      {
        label: "Headshot damage taken",
        value: (c) => c.hero.base.critTakenScale,
        format: (v) => formatPercent(v),
        lowerIsBetter: true,
        show: (h) => h.base.critTakenScale !== 1,
      },
      { label: "Move speed", value: (c) => c.hero.base.moveSpeed, format: dec(" m/s") },
      { label: "Sprint speed", value: (c) => c.hero.base.sprintSpeed, format: (v) => `+${formatNumber(v)} m/s` },
      { label: "Stamina", value: (c) => c.hero.base.stamina, format: int },
      { label: "Stamina cooldown", value: (c) => c.hero.base.staminaCooldown || null, format: dec("s"), lowerIsBetter: true },
    ],
  },
  {
    title: "Gun",
    slot: "weapon",
    stats: [
      { label: "DPS", value: (c) => (c.weapon ? c.s.dps : null), format: dec() },
      { label: "Sustained DPS", value: (c) => (c.weapon ? c.s.sustainedDps : null), format: dec() },
      {
        label: "Bullet damage",
        value: (c) => (c.weapon ? c.s.bulletDamage : null),
        format: dec(),
        perBoon: (h) => plus(h.perBoon.bulletDamage),
      },
      { label: "Fire rate", value: (c) => c.weapon?.shotsPerSecond ?? null, format: dec("/s") },
      { label: "Ammo", value: (c) => c.weapon?.clipSize || null, format: int },
      { label: "Reload time", value: (c) => c.weapon?.reloadTime || null, format: dec("s"), lowerIsBetter: true },
      { label: "Bullet velocity", value: (c) => c.weapon?.bulletSpeed || null, format: (v) => `${int(v)} m/s` },
      { label: "Light melee", value: (c) => c.s.lightMelee, format: dec(), perBoon: (h) => plus(h.perBoon.melee) },
      { label: "Heavy melee", value: (c) => c.s.heavyMelee, format: dec() },
    ],
  },
  {
    title: "Spirit",
    slot: "spirit",
    stats: [{ label: "Spirit power", value: (c) => c.s.spiritPower, format: dec(), perBoon: (h) => plus(h.perBoon.spiritPower) }],
  },
];

const SCALING_METRICS: { id: string; label: string; pick: (s: ScaledStats) => number; format: (v: number) => string; needsGun?: boolean }[] = [
  { id: "health", label: "Health", pick: (s) => s.health, format: int },
  { id: "dps", label: "Gun DPS", pick: (s) => s.dps, format: dec(), needsGun: true },
  { id: "bullet", label: "Bullet damage", pick: (s) => s.bulletDamage, format: dec(), needsGun: true },
  { id: "melee", label: "Melee", pick: (s) => s.lightMelee, format: dec() },
  { id: "spirit", label: "Spirit power", pick: (s) => s.spiritPower, format: dec() },
];

const MAX_BONUS_SPIRIT = 400;

export function HeroDetail({
  hero,
  roster,
  items,
  onBack,
  onSelect,
}: {
  hero: HeroProfile;
  roster: HeroRoster;
  items: ItemMap;
  onBack: () => void;
  onSelect: (id: number) => void;
}) {
  const { heroes, weapons, meta } = roster;
  const maxLevel = hero.levels.at(-1)?.level ?? 1;
  const [level, setLevel] = useState(1);
  const [bonusSpirit, setBonusSpirit] = useState(0);
  const [metric, setMetric] = useState(SCALING_METRICS[0].id);
  const { abilities, error: abilityError } = useHeroAbilities(hero.id);

  const lvl = hero.levels.find((l) => l.level === level) ?? { level, souls: 0, boons: 0 };
  const weapon = hero.weaponClass ? weapons.get(hero.weaponClass) : undefined;
  const scaled = statsAt(hero, weapon, lvl.boons);
  const spiritPower = scaled.spiritPower + bonusSpirit;

  // Every hero at the same boon count, for the rank strips.
  const field = useMemo(
    () =>
      heroes.map((h) => {
        const w = h.weaponClass ? weapons.get(h.weaponClass) : undefined;
        return { hero: h, weapon: w, s: statsAt(h, w, lvl.boons) };
      }),
    [heroes, weapons, lvl.boons],
  );

  const activeMetric = SCALING_METRICS.find((m) => m.id === metric) ?? SCALING_METRICS[0];
  const scalingPoints = useMemo<ScalingPoint[]>(
    () =>
      hero.levels.map((l) => {
        const values = heroes
          .map((h) => {
            const w = h.weaponClass ? weapons.get(h.weaponClass) : undefined;
            if (activeMetric.needsGun && !w) return null;
            return activeMetric.pick(statsAt(h, w, l.boons));
          })
          .filter((v): v is number => v !== null)
          .sort((a, b) => a - b);
        return {
          level: l.level,
          souls: l.souls,
          hero: activeMetric.pick(statsAt(hero, weapon, l.boons)),
          median: values[Math.floor(values.length / 2)] ?? 0,
          min: values[0] ?? 0,
          max: values[values.length - 1] ?? 0,
        };
      }),
    [hero, heroes, weapons, weapon, activeMetric],
  );

  const heroMeta = meta.get(hero.id);
  const metaRank = (pick: (m: NonNullable<typeof heroMeta>) => number) => {
    if (!heroMeta) return null;
    const mine = pick(heroMeta);
    return 1 + [...meta.values()].filter((m) => pick(m) > mine).length;
  };
  const index = heroes.findIndex((h) => h.id === hero.id);
  const neighbour = (d: number) => heroes[(index + d + heroes.length) % heroes.length];

  return (
    <>
      <section className="panel panel--wide hero-head" style={hero.color ? { borderTopColor: hero.color } : undefined}>
        <div className="hero-head__nav">
          <button className="button button--small" onClick={onBack}>← All heroes</button>
          <span className="hero-head__step">
            <button className="button button--small" onClick={() => onSelect(neighbour(-1).id)}>‹ {neighbour(-1).name}</button>
            <button className="button button--small" onClick={() => onSelect(neighbour(1).id)}>{neighbour(1).name} ›</button>
          </span>
        </div>
        <div className="hero-head__body">
          {hero.card && <img className="hero-head__card" src={hero.card} alt="" />}
          <div className="hero-head__info">
            <h2 className="hero-head__name">{hero.name}</h2>
            <div className="hero-head__tags">
              {hero.role && <span className="tag tag--accent">{ROLE_LABELS[hero.role] ?? hero.role}</span>}
              {hero.gunTag && <span className="tag">{hero.gunTag}</span>}
              {hero.tags.map((t) => (
                <span key={t} className="tag">{t}</span>
              ))}
              {hero.complexity !== undefined && <Complexity value={hero.complexity} />}
            </div>
            {hero.summary && <p className="hero-head__summary">{hero.summary}</p>}
            {hero.playstyle && <p className="muted">{hero.playstyle}</p>}
            {hero.lore && (
              <details className="hero-head__lore">
                <summary>Lore</summary>
                <p>{hero.lore}</p>
              </details>
            )}
          </div>
          <dl className="meta-tiles">
            <MetaTile label="Win rate" value={heroMeta ? formatPercent(heroMeta.winRate) : "–"} rank={metaRank((m) => m.winRate)} of={meta.size} />
            <MetaTile label="Pick rate" value={heroMeta ? formatPercent(heroMeta.pickRate) : "–"} rank={metaRank((m) => m.pickRate)} of={meta.size} />
            <MetaTile label="KDA" value={heroMeta ? heroMeta.kda.toFixed(2) : "–"} rank={metaRank((m) => m.kda)} of={meta.size} />
            <MetaTile label="Avg souls" value={heroMeta ? formatSouls(Math.round(heroMeta.avgNetWorth)) : "–"} rank={metaRank((m) => m.avgNetWorth)} of={meta.size} />
            <MetaTile label="Avg hero damage" value={heroMeta ? formatSouls(Math.round(heroMeta.avgDamage)) : "–"} rank={metaRank((m) => m.avgDamage)} of={meta.size} />
          </dl>
        </div>
        {heroMeta && <p className="muted hero-head__note">Last 7 days, all ranks · {heroMeta.matches.toLocaleString("en-US")} matches</p>}
      </section>

      <section className="panel panel--wide level-bar">
        <label className="level-bar__control">
          <span className="level-bar__label">Level</span>
          <input type="range" min={1} max={maxLevel} value={level} onChange={(e) => setLevel(Number(e.target.value))} />
          <span className="level-bar__value">
            <strong>{level}</strong>
            <span className="muted"> · {lvl.souls.toLocaleString("en-US")} souls · {lvl.boons} boons</span>
          </span>
        </label>
        <label className="level-bar__control">
          <span className="level-bar__label">Spirit from items</span>
          <input type="range" min={0} max={MAX_BONUS_SPIRIT} step={5} value={bonusSpirit} onChange={(e) => setBonusSpirit(Number(e.target.value))} />
          <span className="level-bar__value">
            <strong>+{bonusSpirit}</strong>
            <span className="muted"> · {formatNumber(spiritPower)} spirit power total</span>
          </span>
        </label>
        {(level > 1 || bonusSpirit > 0) && (
          <button className="link" onClick={() => { setLevel(1); setBonusSpirit(0); }}>Reset</button>
        )}
      </section>

      <section className="panel">
        <header className="panel__header">
          <h2>Stats</h2>
          <span className="muted">Level {level} · strip shows every hero</span>
        </header>
        {STAT_GROUPS.map((group) => (
          <div key={group.title} className={`stat-group stat-group--${group.slot}`}>
            <h3>{group.title}</h3>
            <div className="stat-rows">
              {group.stats
                .filter((d) => !d.show || d.show(hero))
                .map((def) => {
                  const mine = def.value({ hero, weapon, s: scaled });
                  if (mine === null) return null;
                  const points = field.flatMap((f) => {
                    const v = def.value(f);
                    return v === null ? [] : [{ id: f.hero.id, name: f.hero.name, value: v }];
                  });
                  const rank = 1 + points.filter((p) => (def.lowerIsBetter ? p.value < mine : p.value > mine)).length;
                  const tied = points.every((p) => p.value === mine);
                  const per = def.perBoon?.(hero);
                  return (
                    <div key={def.label} className="stat-row">
                      <span className="stat-row__label">{def.label}</span>
                      <span className="stat-row__value">
                        {def.format(mine)}
                        {per && <small className="muted"> {per}/boon</small>}
                      </span>
                      <RangeStrip points={points} selected={hero.id} format={def.format} />
                      <span className="stat-row__rank muted" title={def.lowerIsBetter ? "Ranked lowest first" : "Ranked highest first"}>
                        {tied ? "" : `#${rank}`}
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
        ))}
      </section>

      <section className="panel">
        <header className="panel__header">
          <h2>Scaling</h2>
          <span className="muted">Boons with souls, vs. all heroes</span>
        </header>
        <div className="segmented" role="tablist" aria-label="Scaling stat">
          {SCALING_METRICS.filter((m) => !m.needsGun || weapon).map((m) => (
            <button
              key={m.id}
              role="tab"
              aria-selected={m.id === activeMetric.id}
              className={`tab ${m.id === activeMetric.id ? "tab--active" : ""}`}
              onClick={() => setMetric(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <ScalingChart points={scalingPoints} heroName={hero.name} currentLevel={level} format={activeMetric.format} />

        {weapon && (
          <div className="weapon">
            <h3>
              {weapon.name}
              <span className="muted weapon__meta">
                {weapon.pellets > 1 ? ` · ${weapon.pellets} pellets` : ""} · headshot ×{formatNumber(weapon.headshotMultiplier)}
              </span>
            </h3>
            <FalloffChart weapon={weapon} bulletDamage={scaled.bulletDamage} />
          </div>
        )}
      </section>

      <section className="panel panel--wide">
        <header className="panel__header">
          <h2>Abilities</h2>
          <span className="chart__legend">
            <span><i className="swatch swatch--base" /> Base</span>
            <span><i className="swatch swatch--spirit" /> From spirit power ({formatNumber(spiritPower)})</span>
          </span>
        </header>
        {abilityError && <p className="error">{abilityError}</p>}
        {!abilities && !abilityError && <p className="muted">Loading abilities…</p>}
        {abilities && (
          <div className="abilities">
            {hero.abilityClasses.map((cls, i) => {
              const ability = abilities.get(cls);
              return ability ? (
                <AbilityCard key={cls} ability={ability} slot={i + 1} ctx={{ spiritPower, boons: lvl.boons }} />
              ) : null;
            })}
          </div>
        )}
      </section>

      {hero.popularItems.length > 0 && (
        <section className="panel panel--wide">
          <header className="panel__header">
            <h2>Popular items</h2>
            <span className="muted">Most bought by phase · bar = pick rate</span>
          </header>
          <div className="popular">
            {hero.popularItems.map(({ phase, items: list }) => (
              <div key={phase}>
                <h3>{phase}</h3>
                <ol className="popular__list">
                  {[...list]
                    .sort((a, b) => b.pickPct - a.pickPct)
                    .slice(0, 8)
                    .map((p) => (
                      <li key={p.itemId} className="popular__row">
                        <ItemIcon id={p.itemId} items={items} withName />
                        <span className="popular__bar" aria-hidden>
                          <span style={{ width: `${Math.min(100, p.pickPct)}%` }} />
                        </span>
                        <span className="popular__num">{p.pickPct.toFixed(0)}%</span>
                        <span className="popular__num muted" title="Win rate when bought">{p.winPct.toFixed(1)}% win</span>
                      </li>
                    ))}
                </ol>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function MetaTile({ label, value, rank, of }: { label: string; value: string; rank: number | null; of: number }) {
  return (
    <div className="meta-tile">
      <dt>{label}</dt>
      <dd>{value}</dd>
      {rank !== null && <dd className="muted meta-tile__rank">#{rank} of {of}</dd>}
    </div>
  );
}

export function Complexity({ value }: { value: number }) {
  // The game rates 1–3; a few heroes go past that.
  const pips = Array.from({ length: Math.max(3, value) }, (_, i) => i + 1);
  return (
    <span className="complexity" title={`Complexity ${value}`} aria-label={`Complexity ${value}`}>
      {pips.map((i) => (
        <i key={i} className={i <= value ? "complexity__pip complexity__pip--on" : "complexity__pip"} />
      ))}
    </span>
  );
}
