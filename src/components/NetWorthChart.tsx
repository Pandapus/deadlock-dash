import { useEffect, useId, useRef, useState } from "react";
import { formatDuration, formatSignedSouls } from "../lib/format";

export interface NetWorthSample {
  /** Match time in seconds. */
  t: number;
  /** Your team's souls minus the enemy's. */
  diff: number;
}

const HEIGHT = 140;
const PAD = { top: 10, right: 12, bottom: 20, left: 44 };

/** Diverging area chart of the soul lead over time: up = your team ahead. */
export function NetWorthChart({ samples, emptyText }: { samples: NetWorthSample[]; emptyText?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The wrapper is always rendered so the ResizeObserver has something to observe.
  return (
    <div className="chart" ref={ref}>
      {samples.length < 2 ? (
        <p className="muted chart-empty">
          {emptyText ?? "Soul lead graph appears after a couple of updates (the feed refreshes about once a minute)."}
        </p>
      ) : (
        <Plot samples={samples} width={width} />
      )}
    </div>
  );
}

function Plot({ samples, width }: { samples: NetWorthSample[]; width: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const clipId = useId();

  const t0 = samples[0].t;
  const t1 = samples[samples.length - 1].t;
  const extent = Math.max(1000, ...samples.map((s) => Math.abs(s.diff)));
  const innerW = Math.max(1, width - PAD.left - PAD.right);
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const x = (t: number) => PAD.left + ((t - t0) / Math.max(1, t1 - t0)) * innerW;
  const y = (v: number) => PAD.top + innerH / 2 - (v / extent) * (innerH / 2);
  const zeroY = y(0);

  const line = samples.map((s, i) => `${i ? "L" : "M"}${x(s.t)},${y(s.diff)}`).join("");
  const area = `${line}L${x(t1)},${zeroY}L${x(t0)},${zeroY}Z`;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left + PAD.left;
    let nearest = 0;
    samples.forEach((s, i) => {
      if (Math.abs(x(s.t) - px) < Math.abs(x(samples[nearest].t) - px)) nearest = i;
    });
    setHover(nearest);
  };

  const hovered = hover !== null ? samples[hover] : null;

  return (
    <>
      <div className="chart__legend">
        <span><i className="swatch swatch--ally" /> Your team ahead</span>
        <span><i className="swatch swatch--enemy" /> Enemy ahead</span>
      </div>
      <svg width={width} height={HEIGHT} role="img" aria-label="Soul lead over time">
        <defs>
          <clipPath id={`${clipId}-above`}>
            <rect x={0} y={0} width={width} height={zeroY} />
          </clipPath>
          <clipPath id={`${clipId}-below`}>
            <rect x={0} y={zeroY} width={width} height={HEIGHT - zeroY} />
          </clipPath>
        </defs>
        <line className="chart__grid" x1={PAD.left} x2={width - PAD.right} y1={y(extent)} y2={y(extent)} />
        <line className="chart__grid" x1={PAD.left} x2={width - PAD.right} y1={y(-extent)} y2={y(-extent)} />
        <text className="chart__label" x={PAD.left - 6} y={y(extent) + 4} textAnchor="end">{formatSignedSouls(extent)}</text>
        <text className="chart__label" x={PAD.left - 6} y={zeroY + 4} textAnchor="end">0</text>
        <text className="chart__label" x={PAD.left - 6} y={y(-extent) + 4} textAnchor="end">{formatSignedSouls(-extent)}</text>
        <text className="chart__label" x={PAD.left} y={HEIGHT - 4}>{formatDuration(t0)}</text>
        <text className="chart__label" x={width - PAD.right} y={HEIGHT - 4} textAnchor="end">{formatDuration(t1)}</text>

        <path d={area} className="chart__area chart__area--ally" clipPath={`url(#${clipId}-above)`} />
        <path d={area} className="chart__area chart__area--enemy" clipPath={`url(#${clipId}-below)`} />
        <path d={line} className="chart__line chart__line--ally" clipPath={`url(#${clipId}-above)`} />
        <path d={line} className="chart__line chart__line--enemy" clipPath={`url(#${clipId}-below)`} />
        <line className="chart__baseline" x1={PAD.left} x2={width - PAD.right} y1={zeroY} y2={zeroY} />

        {hovered && (
          <g>
            <line className="chart__crosshair" x1={x(hovered.t)} x2={x(hovered.t)} y1={PAD.top} y2={PAD.top + innerH} />
            <circle className={hovered.diff >= 0 ? "chart__dot--ally" : "chart__dot--enemy"} cx={x(hovered.t)} cy={y(hovered.diff)} r={4} />
          </g>
        )}
        <rect
          x={PAD.left}
          y={0}
          width={innerW}
          height={HEIGHT}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      {hovered && (
        <div
          className="chart__tooltip"
          style={{ left: Math.min(Math.max(x(hovered.t), 70), width - 70), top: 28 }}
        >
          <strong>{formatDuration(hovered.t)}</strong>
          <span>
            {hovered.diff === 0 ? "Even" : `${hovered.diff > 0 ? "Your team" : "Enemy"} ${formatSignedSouls(Math.abs(hovered.diff))}`}
          </span>
        </div>
      )}
      <details className="chart__table">
        <summary>Show data</summary>
        <table className="table">
          <thead>
            <tr><th>Time</th><th className="num">Soul lead (your team)</th></tr>
          </thead>
          <tbody>
            {samples.map((s) => (
              <tr key={s.t}><td>{formatDuration(s.t)}</td><td className="num">{formatSignedSouls(s.diff)}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}
