export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function formatSouls(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}

export function formatSignedSouls(value: number): string {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatSouls(Math.abs(value))}`;
}

export function formatRelativeTime(unixSeconds: number): string {
  const diff = Date.now() / 1000 - unixSeconds;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function formatKda(kills: number, deaths: number, assists: number): string {
  return ((kills + assists) / Math.max(1, deaths)).toFixed(1);
}

export function formatPercent(ratio: number | null): string {
  return ratio === null ? "–" : `${Math.round(ratio * 100)}%`;
}

/** Exact shop price, e.g. "3,200". */
export function formatCost(value: number): string {
  return value.toLocaleString("en-US");
}

/** Match clock, negative during the pre-game countdown. */
export function formatClock(seconds: number): string {
  return seconds < 0 ? `−${formatDuration(-seconds)}` : formatDuration(seconds);
}
