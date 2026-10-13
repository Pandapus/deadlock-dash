import { useEffect, useRef, useState, type RefObject } from "react";
import { formatPercent } from "../lib/format";
import { falloffAt, type HeroMeta, type HeroProfile, type Weapon } from "../lib/heroStats";
import { formatNumber } from "../lib/abilities";

const PAD = { top: 12, right: 16, bottom: 24, left: 48 };

function useWidth(ref: RefObject<HTMLDivElement | null>, initial = 600): number {
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** Round tick values covering [min, max], about `count` of them. */
function ticks(min: number, max: number, count = 4): number[] {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

function compact(n: number): string {
  return n >= 1000 ? `${Number((n / 1000).toFixed(1))}k` : formatNumber(n);
}

export interface ScalingPoint {
  level: number;
  souls: number;
  hero: number;
  median: number;
  min: number;
  max: number;
}

const SCALING_HEIGHT = 200;

/**
 * One stat across the soul curve: this hero's line over the roster's min–max
 * band and median. Values only change at level-ups, so lines are drawn as steps.
 */
export function ScalingChart({
  points,
  heroName,
  currentLevel,
  format,
}: {
  points: ScalingPoint[];
  heroName: string;
  currentLevel: number;
  format: (v: number) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return <div ref={ref} />;

  const maxSouls = points[points.length - 1].souls;
  const yMax = Math.max(...points.map((p) => p.max)) * 1.05 || 1;
  const yTicks = ticks(0, yMax);
  const top = yTicks[yTicks.length - 1] ?? yMax;
  const innerW = Math.max(1, width - PAD.left - PAD.right);
  const innerH = SCALING_HEIGHT - PAD.top - PAD.bottom;
  const x = (souls: number) => PAD.left + (souls / Math.max(1, maxSouls)) * innerW;
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;

  const step = (pick: (p: ScalingPoint) => number) =>
    points
      .map((p, i) => {
        const next = points[i + 1]?.souls ?? maxSouls;
        return `${i ? "L" : "M"}${x(p.souls)},${y(pick(p))}H${x(next)}`;
      })
      .join("");
  const upper = step((p) => p.max);
  const lowerBack = [...points]
    .reverse()
    .map((p, i, arr) => {
      const next = i === 0 ? maxSouls : arr[i - 1].souls;
      return `L${x(next)},${y(p.min)}H${x(p.souls)}`;
    })
    .join("");
  const band = `${upper}${lowerBack}Z`;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const souls = ((e.clientX - box.left) / box.width) * maxSouls;
    let idx = 0;
    points.forEach((p, i) => {
      if (p.souls <= souls) idx = i;
    });
    setHover(idx);
  };

  const current = points.find((p) => p.level === currentLevel);
  const hovered = hover !== null ? points[hover] : null;
  const last = points[points.length - 1];

  return (
    <div className="chart" ref={ref}>
      <div className="chart__legend">
        <span><i className="swatch swatch--hero" /> {heroName}</span>
        <span><i className="swatch swatch--median" /> Median hero</span>
        <span><i className="swatch swatch--band" /> Range, all heroes</span>
      </div>
      <svg width={width} height={SCALING_HEIGHT} role="img" aria-label={`${heroName} compared with all heroes as souls increase`}>
        {yTicks.map((t) => (
          <g key={t}>
            <line className={t === 0 ? "chart__baseline" : "chart__grid"} x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
            <text className="chart__label" x={PAD.left - 6} y={y(t) + 4} textAnchor="end">{compact(t)}</text>
          </g>
        ))}
        {ticks(0, maxSouls, 5).map((t) => (
          <text key={t} className="chart__label" x={x(t)} y={SCALING_HEIGHT - 6} textAnchor="middle">{compact(t)}</text>
        ))}
        <path d={band} className="chart__band" />
        <path d={step((p) => p.median)} className="chart__line chart__line--median" />
        <path d={step((p) => p.hero)} className="chart__line chart__line--hero" />
        <text className="chart__end-label" x={width - PAD.right} y={y(last.hero) - 6} textAnchor="end">{format(last.hero)}</text>
        {current && (
          <g>
            <line className="chart__marker" x1={x(current.souls)} x2={x(current.souls)} y1={PAD.top} y2={PAD.top + innerH} />
            <circle className="chart__dot--hero" cx={x(current.souls)} cy={y(current.hero)} r={4} />
          </g>
        )}
        {hovered && (
          <line className="chart__crosshair" x1={x(hovered.souls)} x2={x(hovered.souls)} y1={PAD.top} y2={PAD.top + innerH} />
        )}
        <rect
          x={PAD.left}
          y={0}
          width={innerW}
          height={SCALING_HEIGHT}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      <div className="chart__axis-title">Souls</div>
      {hovered && (
        <div className="chart__tooltip" style={{ left: Math.min(Math.max(x(hovered.souls), 90), width - 90), top: 24 }}>
          <strong>Level {hovered.level} · {hovered.souls.toLocaleString("en-US")} souls</strong>
          <span>{heroName}: {format(hovered.hero)}</span>
          <span className="muted">Median {format(hovered.median)} · range {format(hovered.min)}–{format(hovered.max)}</span>
        </div>
      )}
      <details className="chart__table">
        <summary>Show data</summary>
        <table className="table">
          <thead>
            <tr>
              <th>Level</th>
              <th className="num">Souls</th>
              <th className="num">{heroName}</th>
              <th className="num">Median</th>
              <th className="num">Min</th>
              <th className="num">Max</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.level}>
                <td>{p.level}</td>
                <td className="num">{p.souls.toLocaleString("en-US")}</td>
                <td className="num">{format(p.hero)}</td>
                <td className="num">{format(p.median)}</td>
                <td className="num">{format(p.min)}</td>
                <td className="num">{format(p.max)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

const FALLOFF_HEIGHT = 160;

/** Share of bullet damage dealt at each distance. */
export function FalloffChart({ weapon, bulletDamage }: { weapon: Weapon; bulletDamage: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const [hover, setHover] = useState<number | null>(null);
  const f = weapon.falloff;
  const maxM = Math.max(60, Math.ceil((f.endM + 10) / 10) * 10);
  const yTop = Math.max(1, f.startScale);
  const innerW = Math.max(1, width - PAD.left - PAD.right);
  const innerH = FALLOFF_HEIGHT - PAD.top - PAD.bottom;
  const x = (m: number) => PAD.left + (m / maxM) * innerW;
  const y = (s: number) => PAD.top + innerH - (s / yTop) * innerH;

  const samples: [number, number][] = [];
  for (let m = 0; m <= maxM; m += maxM / 120) samples.push([m, falloffAt(f, m)]);
  const line = samples.map(([m, s], i) => `${i ? "L" : "M"}${x(m)},${y(s)}`).join("");
  const area = `${line}L${x(maxM)},${y(0)}L${x(0)},${y(0)}Z`;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    setHover(Math.max(0, Math.min(maxM, Math.round(((e.clientX - box.left) / box.width) * maxM))));
  };
  const hoverScale = hover !== null ? falloffAt(f, hover) : null;

  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={FALLOFF_HEIGHT} role="img" aria-label="Bullet damage by distance">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line className={t === 0 ? "chart__baseline" : "chart__grid"} x1={PAD.left} x2={width - PAD.right} y1={y(t * yTop)} y2={y(t * yTop)} />
            <text className="chart__label" x={PAD.left - 6} y={y(t * yTop) + 4} textAnchor="end">{formatPercent(t * yTop)}</text>
          </g>
        ))}
        {ticks(0, maxM, 6).map((t) => (
          <text key={t} className="chart__label" x={x(t)} y={FALLOFF_HEIGHT - 6} textAnchor="middle">{t}m</text>
        ))}
        <path d={area} className="chart__area chart__area--weapon" />
        <path d={line} className="chart__line chart__line--weapon" />
        {f.endM > f.startM &&
          [
            { m: f.startM, label: `Falloff starts ${Math.round(f.startM)}m` },
            { m: f.endM, label: `Minimum ${formatPercent(f.endScale)} at ${Math.round(f.endM)}m` },
          ].map((mark, i) => (
            <g key={i}>
              <circle className="chart__dot--weapon" cx={x(mark.m)} cy={y(falloffAt(f, mark.m))} r={4} />
              {/* Start sits on the top edge, so its label goes below the line; the end label is kept inside the plot. */}
              <text
                className="chart__annotation"
                x={i === 0 ? x(mark.m) + 8 : Math.min(x(mark.m), width - PAD.right - 70)}
                y={y(falloffAt(f, mark.m)) + (i === 0 ? 16 : -8)}
                textAnchor={i === 0 ? "start" : "middle"}
              >
                {mark.label}
              </text>
            </g>
          ))}
        {hover !== null && hoverScale !== null && (
          <g>
            <line className="chart__crosshair" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} />
            <circle className="chart__dot--weapon" cx={x(hover)} cy={y(hoverScale)} r={4} />
          </g>
        )}
        <rect
          x={PAD.left}
          y={0}
          width={innerW}
          height={FALLOFF_HEIGHT}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      {hover !== null && hoverScale !== null && (
        <div className="chart__tooltip" style={{ left: Math.min(Math.max(x(hover), 80), width - 80), top: 8 }}>
          <strong>{hover}m</strong>
          <span>{formatPercent(hoverScale)} damage · {formatNumber(bulletDamage * hoverScale)} per bullet</span>
        </div>
      )}
    </div>
  );
}

const META_HEIGHT = 280;
const ICON = 26;

/** Pick rate against win rate, one portrait per hero. */
export function MetaScatter({
  heroes,
  meta,
  onSelect,
}: {
  heroes: HeroProfile[];
  meta: Map<number, HeroMeta>;
  onSelect: (id: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const [hover, setHover] = useState<number | null>(null);
  const pad = { ...PAD, top: 18, right: 24, left: 52, bottom: 30 };

  const rows = heroes.flatMap((h) => {
    const m = meta.get(h.id);
    return m ? [{ hero: h, m }] : [];
  });
  if (rows.length === 0) return <div ref={ref} />;

  const xMax = Math.max(...rows.map((r) => r.m.pickRate)) * 1.08;
  const wr = rows.map((r) => r.m.winRate);
  // Symmetric around 50% so above/below the line reads at a glance.
  const spread = Math.max(0.04, ...wr.map((w) => Math.abs(w - 0.5))) + 0.01;
  const [yMin, yMax] = [0.5 - spread, 0.5 + spread];
  const innerW = Math.max(1, width - pad.left - pad.right);
  const innerH = META_HEIGHT - pad.top - pad.bottom;
  const x = (v: number) => pad.left + (v / xMax) * innerW;
  const y = (v: number) => pad.top + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left + pad.left;
    const py = e.clientY - box.top + pad.top;
    let best: number | null = null;
    let bestD = 24 ** 2;
    for (const r of rows) {
      const d = (x(r.m.pickRate) - px) ** 2 + (y(r.m.winRate) - py) ** 2;
      if (d < bestD) {
        bestD = d;
        best = r.hero.id;
      }
    }
    setHover(best);
  };

  const hovered = rows.find((r) => r.hero.id === hover);

  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={META_HEIGHT} role="img" aria-label="Hero win rate against pick rate">
        <defs>
          <clipPath id="meta-icon">
            <circle cx={ICON / 2} cy={ICON / 2} r={ICON / 2} />
          </clipPath>
        </defs>
        {ticks(yMin, yMax, 4).map((t) => (
          <g key={t}>
            <line className={Math.abs(t - 0.5) < 1e-6 ? "chart__baseline" : "chart__grid"} x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} />
            <text className="chart__label" x={pad.left - 6} y={y(t) + 4} textAnchor="end">{(t * 100).toFixed(0)}%</text>
          </g>
        ))}
        {ticks(0, xMax, 5).map((t) => (
          <text key={t} className="chart__label" x={x(t)} y={META_HEIGHT - 12} textAnchor="middle">{(t * 100).toFixed(0)}%</text>
        ))}
        <text className="chart__label" x={width - pad.right} y={META_HEIGHT - 1} textAnchor="end">Pick rate →</text>
        <text className="chart__label" x={pad.left} y={10}>↑ Win rate</text>
        {rows.map(({ hero, m }) => (
          <g
            key={hero.id}
            transform={`translate(${x(m.pickRate) - ICON / 2},${y(m.winRate) - ICON / 2})`}
            className={`meta-point ${hover === hero.id ? "meta-point--hover" : ""}`}
          >
            <circle cx={ICON / 2} cy={ICON / 2} r={ICON / 2 + 2} className="meta-point__ring" />
            {hero.icon ? (
              <image href={hero.icon} width={ICON} height={ICON} clipPath="url(#meta-icon)" preserveAspectRatio="xMidYMid slice" />
            ) : (
              <circle cx={ICON / 2} cy={ICON / 2} r={ICON / 2} className="meta-point__fallback" />
            )}
          </g>
        ))}
        <rect
          x={pad.left}
          y={0}
          width={innerW}
          height={META_HEIGHT}
          fill="transparent"
          style={{ cursor: hover !== null ? "pointer" : "default" }}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          onClick={() => hover !== null && onSelect(hover)}
        />
      </svg>
      {hovered && (
        <div
          className="chart__tooltip"
          style={{ left: Math.min(Math.max(x(hovered.m.pickRate), 90), width - 90), top: Math.max(0, y(hovered.m.winRate) - 78) }}
        >
          <strong>{hovered.hero.name}</strong>
          <span>{formatPercent(hovered.m.winRate)} win rate · {formatPercent(hovered.m.pickRate)} pick rate</span>
          <span className="muted">{hovered.m.matches.toLocaleString("en-US")} matches · click to open</span>
        </div>
      )}
    </div>
  );
}

export interface StripPoint {
  id: number;
  name: string;
  value: number;
}

/**
 * Where one hero's value sits among every hero's: each hero is a faint tick,
 * the selected one a filled marker.
 */
export function RangeStrip({ points, selected, format }: { points: StripPoint[]; selected: number; format: (v: number) => string }) {
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pos = (v: number) => (max > min ? ((v - min) / (max - min)) * 100 : 50);
  const me = points.find((p) => p.id === selected);
  // Every hero ties (e.g. spirit power before any boons): nothing to place.
  if (max === min) return <div className="strip strip--flat muted">Same for every hero</div>;
  return (
    <div className="strip" title={`Lowest ${format(min)} · highest ${format(max)}`}>
      <div className="strip__track" />
      {points
        .filter((p) => p.id !== selected)
        .map((p) => (
          <span key={p.id} className="strip__tick" style={{ left: `${pos(p.value)}%` }} title={`${p.name}: ${format(p.value)}`} />
        ))}
      {me && <span className="strip__me" style={{ left: `${pos(me.value)}%` }} />}
    </div>
  );
}
