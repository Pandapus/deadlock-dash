import { useEffect, useRef, useState } from "react";
import { formatDuration } from "../lib/format";
import { CHART_PAD, type TeamLabels } from "./NetWorthChart";

export interface TimelineEvent {
  /** Match time in seconds. */
  t: number;
  /** Which team scored it: ally kills sit above the axis, enemy kills below. */
  side: "ally" | "enemy";
  label: string;
  detail?: string;
  /** Involves the player the page is about; drawn with an accent ring. */
  mine?: boolean;
}

const ROW = 11;
const R = 4;
const MAX_ROWS = 4;
/** Closer than this and a dot stacks on the next row instead of overlapping. */
const MIN_GAP_PX = 10;
const AXIS_GAP = 8;
const LABELS_H = 18;
const TICK_EVERY = 300;

interface Placed extends TimelineEvent {
  cx: number;
  cy: number;
}

/**
 * Kills along the match clock. Shares the soul-lead chart's horizontal padding,
 * so the two line up when stacked with the same `domain`.
 */
export function KillTimeline({
  events,
  domain,
  labels,
}: {
  events: TimelineEvent[];
  domain: [number, number];
  labels: TeamLabels;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<Placed | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const [t0, t1] = domain;
  const innerW = Math.max(1, width - CHART_PAD.left - CHART_PAD.right);
  const x = (t: number) => CHART_PAD.left + ((Math.min(Math.max(t, t0), t1) - t0) / Math.max(1, t1 - t0)) * innerW;

  // Greedy stacking: each dot takes the lowest row that's free at its x.
  const rows = { ally: [] as number[], enemy: [] as number[] };
  const levels = [...events]
    .sort((a, b) => a.t - b.t)
    .map((e) => {
      const used = rows[e.side];
      const cx = x(e.t);
      let level = used.findIndex((lastX) => cx - lastX >= MIN_GAP_PX);
      if (level === -1) level = used.length < MAX_ROWS ? used.length : used.indexOf(Math.min(...used));
      used[level] = cx;
      return { e, cx, level };
    });
  const rowsAbove = Math.max(1, rows.ally.length);
  const rowsBelow = Math.max(1, rows.enemy.length);
  const axisY = CHART_PAD.top + rowsAbove * ROW + AXIS_GAP / 2;
  const height = axisY + AXIS_GAP / 2 + rowsBelow * ROW + LABELS_H;
  const placed: Placed[] = levels.map(({ e, cx, level }) => ({
    ...e,
    cx,
    cy: e.side === "ally" ? axisY - AXIS_GAP / 2 - R - level * ROW : axisY + AXIS_GAP / 2 + R + level * ROW,
  }));

  const ticks: number[] = [];
  for (let t = Math.ceil(t0 / TICK_EVERY) * TICK_EVERY; t <= t1; t += TICK_EVERY) ticks.push(t);

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left;
    const py = e.clientY - box.top;
    let best: Placed | null = null;
    let bestDist = 16 * 16;
    for (const p of placed) {
      const d = (p.cx - px) ** 2 + (p.cy - py) ** 2;
      if (d < bestDist) [best, bestDist] = [p, d];
    }
    setHover(best);
  };

  return (
    <div className="chart" ref={ref}>
      <div className="chart__legend">
        <span>
          <i className="swatch swatch--ally" /> {labels.ally} kills
        </span>
        <span>
          <i className="swatch swatch--enemy" /> {labels.enemy} kills
        </span>
        {placed.some((p) => p.mine) && (
          <span>
            <i className="swatch swatch--mine" /> Involves this player
          </span>
        )}
      </div>
      <div className="chart__plot">
        <svg width={width} height={height} role="img" aria-label="Kills over time">
          {ticks.map((t) => (
            <g key={t}>
              <line className="chart__grid" x1={x(t)} x2={x(t)} y1={CHART_PAD.top} y2={height - LABELS_H} />
              <text className="chart__label" x={x(t)} y={height - 4} textAnchor="middle">
                {formatDuration(t)}
              </text>
            </g>
          ))}
          <line className="chart__baseline" x1={CHART_PAD.left} x2={width - CHART_PAD.right} y1={axisY} y2={axisY} />
          <text className="chart__label" x={CHART_PAD.left - 6} y={axisY - AXIS_GAP / 2 - 2} textAnchor="end">
            {placed.filter((p) => p.side === "ally").length}
          </text>
          <text className="chart__label" x={CHART_PAD.left - 6} y={axisY + AXIS_GAP / 2 + 9} textAnchor="end">
            {placed.filter((p) => p.side === "enemy").length}
          </text>
          {placed.map((p, i) => (
            <g key={i}>
              {p.mine && <circle className="timeline__ring" cx={p.cx} cy={p.cy} r={R + 2.5} />}
              <circle
                className={`timeline__dot timeline__dot--${p.side} ${hover === p ? "timeline__dot--hover" : ""}`}
                cx={p.cx}
                cy={p.cy}
                r={R}
              />
            </g>
          ))}
          <rect
            x={0}
            y={0}
            width={width}
            height={height}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
        {hover && (
          <div
            className="chart__tooltip"
            style={{
              left: Math.min(Math.max(hover.cx, 110), width - 110),
              top: hover.side === "ally" ? hover.cy + 10 : undefined,
              bottom: hover.side === "enemy" ? height - hover.cy + 10 : undefined,
            }}
          >
            <strong>{formatDuration(hover.t)}</strong>
            <span>{hover.label}</span>
            {hover.detail && <span className="muted">{hover.detail}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
