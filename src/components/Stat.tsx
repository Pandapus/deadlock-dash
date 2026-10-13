export function Stat({ label, value, tone }: { label: string; value: string; tone?: "ally" | "enemy" }) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className={`stat__value ${tone ? `stat__value--${tone}` : ""}`}>{value}</span>
    </div>
  );
}
