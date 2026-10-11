import type { HeroMap } from "../hooks/useHeroes";

export function HeroBadge({ heroId, heroes, compact }: { heroId: number | null | undefined; heroes: HeroMap; compact?: boolean }) {
  const hero = heroId != null ? heroes.get(heroId) : undefined;
  const name = hero?.name ?? (heroId != null ? `Hero ${heroId}` : "Unknown");
  const icon = hero?.images.icon_image_small_webp ?? hero?.images.icon_image_small;
  return (
    <span className="hero-badge" title={name}>
      {icon ? <img src={icon} alt="" /> : <span className="hero-badge__placeholder" />}
      {!compact && <span>{name}</span>}
    </span>
  );
}
