// Hero and weapon models for the Heroes tab, built from the asset payloads, and
// the per-boon scaling maths. The raw shapes are large, so only what the page
// renders is kept.
import type { Hero } from "../api/types";

/** Source engine units per metre (falloff ranges and bullet speed are in units). */
const UNITS_PER_METRE = 39.37;

interface RawStat {
  value: number;
}

interface RawPopularItem {
  item_id: number;
  pick_pct: number;
  winrate_pct: number;
}

/** GET /v1/assets/heroes, the parts beyond the slim `Hero` the rest of the app uses. */
export interface RawHero extends Hero {
  description?: { lore?: string; role?: string; playstyle?: string };
  tags?: string[];
  gun_tag?: string;
  hero_type?: string;
  complexity?: number;
  colors?: { style_hex?: string };
  images: Hero["images"] & { icon_hero_card_webp?: string; background_image_webp?: string };
  items?: Record<string, string>;
  starting_stats?: Record<string, RawStat | undefined>;
  standard_level_up_upgrades?: Record<string, number>;
  level_info?: Record<string, { required_gold?: number; use_standard_upgrade?: boolean }>;
  popular_items?: Partial<Record<"early_game" | "mid_game" | "late_game", RawPopularItem[]>>;
}

export interface Level {
  level: number;
  /** Souls needed to reach it. */
  souls: number;
  /** Boons (standard stat upgrades) gained by this level. */
  boons: number;
}

export interface PopularItem {
  itemId: number;
  pickPct: number;
  winPct: number;
}

export interface HeroProfile {
  id: number;
  name: string;
  role?: string;
  gunTag?: string;
  tags: string[];
  complexity?: number;
  color?: string;
  icon?: string;
  card?: string;
  summary?: string;
  playstyle?: string;
  lore?: string;
  weaponClass?: string;
  /** Ability class names in slot order 1–4 (4 is the ultimate). */
  abilityClasses: string[];
  base: {
    maxHealth: number;
    healthRegen: number;
    moveSpeed: number;
    sprintSpeed: number;
    stamina: number;
    /** Seconds to regain one stamina charge. */
    staminaCooldown: number;
    lightMelee: number;
    heavyMelee: number;
    /** Multiplier on headshot damage taken; below 1 for heroes with small heads. */
    critTakenScale: number;
  };
  /** Added per boon. Resists are in percent. */
  perBoon: {
    health: number;
    bulletDamage: number;
    melee: number;
    spiritPower: number;
    bulletResist: number;
    spiritResist: number;
  };
  levels: Level[];
  popularItems: { phase: string; items: PopularItem[] }[];
}

export function toHeroProfile(raw: RawHero): HeroProfile {
  const stat = (key: string) => raw.starting_stats?.[key]?.value ?? 0;
  const up = (key: string) => raw.standard_level_up_upgrades?.[`MODIFIER_VALUE_${key}`] ?? 0;
  const regen = stat("stamina_regen_per_second");
  const phases = [
    ["Early game", raw.popular_items?.early_game],
    ["Mid game", raw.popular_items?.mid_game],
    ["Late game", raw.popular_items?.late_game],
  ] as const;

  return {
    id: raw.id,
    name: raw.name,
    role: raw.hero_type,
    gunTag: raw.gun_tag,
    tags: raw.tags ?? [],
    complexity: raw.complexity,
    color: raw.colors?.style_hex,
    icon: raw.images.icon_image_small_webp ?? raw.images.icon_image_small,
    card: raw.images.icon_hero_card_webp ?? raw.images.icon_hero_card,
    summary: raw.description?.role,
    playstyle: raw.description?.playstyle,
    lore: raw.description?.lore,
    weaponClass: raw.items?.weapon_primary,
    abilityClasses: [1, 2, 3, 4].map((n) => raw.items?.[`signature${n}`]).filter((c): c is string => !!c),
    base: {
      maxHealth: stat("max_health"),
      healthRegen: stat("base_health_regen"),
      moveSpeed: stat("max_move_speed"),
      sprintSpeed: stat("sprint_speed"),
      stamina: stat("stamina"),
      staminaCooldown: regen > 0 ? 1 / regen : 0,
      lightMelee: stat("light_melee_damage"),
      heavyMelee: stat("heavy_melee_damage"),
      critTakenScale: raw.starting_stats?.crit_damage_received_scale?.value ?? 1,
    },
    perBoon: {
      health: up("BASE_HEALTH_FROM_LEVEL"),
      bulletDamage: up("BASE_BULLET_DAMAGE_FROM_LEVEL"),
      melee: up("BASE_MELEE_DAMAGE_FROM_LEVEL"),
      spiritPower: up("TECH_POWER"),
      bulletResist: up("BULLET_ARMOR_DAMAGE_RESIST"),
      spiritResist: up("TECH_RESIST"),
    },
    levels: toLevels(raw.level_info),
    popularItems: phases
      .filter(([, list]) => list && list.length > 0)
      .map(([phase, list]) => ({
        phase,
        items: list!.map((i) => ({ itemId: i.item_id, pickPct: i.pick_pct, winPct: i.winrate_pct })),
      })),
  };
}

function toLevels(info: RawHero["level_info"]): Level[] {
  const entries = Object.entries(info ?? {})
    .map(([level, l]) => ({ level: Number(level), souls: l.required_gold ?? 0, boon: l.use_standard_upgrade === true }))
    .filter((l) => Number.isFinite(l.level))
    .sort((a, b) => a.level - b.level);
  let boons = 0;
  return entries.map((l) => {
    if (l.boon) boons++;
    return { level: l.level, souls: l.souls, boons };
  });
}

/** GET /v1/assets/items/by-type/weapon, one entry per hero gun. */
export interface RawWeapon {
  class_name: string;
  name?: string;
  weapon_info?: {
    bullet_damage?: number;
    bullets?: number;
    clip_size?: number;
    reload_duration?: number;
    bullet_speed?: number;
    crit_bonus_start?: number;
    damage_falloff_start_range?: number;
    damage_falloff_end_range?: number;
    damage_falloff_start_scale?: number;
    damage_falloff_end_scale?: number;
    damage_falloff_bias?: number;
    shots_per_second?: number;
    damage_per_second?: number;
    damage_per_second_with_reload?: number;
    damage_per_magazine?: number;
  };
}

export interface Weapon {
  name: string;
  bulletDamage: number;
  /** Pellets per shot. */
  pellets: number;
  shotsPerSecond: number;
  clipSize: number;
  reloadTime: number;
  dps: number;
  /** DPS averaged over full magazines including reloads. */
  sustainedDps: number;
  /** m/s */
  bulletSpeed: number;
  headshotMultiplier: number;
  falloff: { startM: number; endM: number; startScale: number; endScale: number; bias: number };
}

export function toWeapon(raw: RawWeapon): Weapon | null {
  const w = raw.weapon_info;
  if (!w || !w.bullet_damage) return null;
  return {
    name: raw.name ?? raw.class_name,
    bulletDamage: w.bullet_damage,
    pellets: w.bullets ?? 1,
    shotsPerSecond: w.shots_per_second ?? 0,
    clipSize: w.clip_size ?? 0,
    reloadTime: w.reload_duration ?? 0,
    dps: w.damage_per_second ?? 0,
    sustainedDps: w.damage_per_second_with_reload ?? w.damage_per_second ?? 0,
    bulletSpeed: (w.bullet_speed ?? 0) / UNITS_PER_METRE,
    headshotMultiplier: w.crit_bonus_start ?? 1,
    falloff: {
      startM: (w.damage_falloff_start_range ?? 0) / UNITS_PER_METRE,
      endM: (w.damage_falloff_end_range ?? 0) / UNITS_PER_METRE,
      startScale: w.damage_falloff_start_scale ?? 1,
      endScale: w.damage_falloff_end_scale ?? 1,
      bias: w.damage_falloff_bias ?? 0.5,
    },
  };
}

/** Damage multiplier at `metres`, using Source's bias curve between the two ranges. */
export function falloffAt(f: Weapon["falloff"], metres: number): number {
  if (f.endM <= f.startM || metres <= f.startM) return f.startScale;
  if (metres >= f.endM) return f.endScale;
  const t = (metres - f.startM) / (f.endM - f.startM);
  const b = Math.min(Math.max(f.bias, 0.01), 0.99);
  const biased = t / ((1 / b - 2) * (1 - t) + 1);
  return f.startScale + (f.endScale - f.startScale) * biased;
}

/** Everything on the page that grows with boons, at a given boon count. */
export interface ScaledStats {
  health: number;
  bulletDamage: number;
  dps: number;
  sustainedDps: number;
  lightMelee: number;
  heavyMelee: number;
  spiritPower: number;
  bulletResist: number;
  spiritResist: number;
}

export function statsAt(hero: HeroProfile, weapon: Weapon | undefined, boons: number): ScaledStats {
  const bullet = (weapon?.bulletDamage ?? 0) + hero.perBoon.bulletDamage * boons;
  // DPS is linear in bullet damage, so the API's DPS figures scale with it.
  const gunScale = weapon && weapon.bulletDamage > 0 ? bullet / weapon.bulletDamage : 1;
  const light = hero.base.lightMelee + hero.perBoon.melee * boons;
  // Heavy melee grows in proportion to light melee.
  const meleeScale = hero.base.lightMelee > 0 ? light / hero.base.lightMelee : 1;
  return {
    health: hero.base.maxHealth + hero.perBoon.health * boons,
    bulletDamage: bullet,
    dps: (weapon?.dps ?? 0) * gunScale,
    sustainedDps: (weapon?.sustainedDps ?? 0) * gunScale,
    lightMelee: light,
    heavyMelee: hero.base.heavyMelee * meleeScale,
    spiritPower: hero.perBoon.spiritPower * boons,
    bulletResist: hero.perBoon.bulletResist * boons,
    spiritResist: hero.perBoon.spiritResist * boons,
  };
}

/** Win/pick rates and per-match averages over the analytics window. */
export interface HeroMeta {
  matches: number;
  winRate: number;
  pickRate: number;
  kda: number;
  avgNetWorth: number;
  avgDamage: number;
}

export interface RawHeroAnalytics {
  hero_id: number;
  wins: number;
  matches: number;
  total_kills: number;
  total_deaths: number;
  total_assists: number;
  total_net_worth: number;
  total_player_damage: number;
}

export function toHeroMeta(rows: RawHeroAnalytics[]): Map<number, HeroMeta> {
  // 12 players per match, so each match is counted 12 times across heroes.
  const games = rows.reduce((sum, r) => sum + r.matches, 0) / 12;
  return new Map(
    rows
      .filter((r) => r.matches > 0)
      .map((r) => [
        r.hero_id,
        {
          matches: r.matches,
          winRate: r.wins / r.matches,
          pickRate: games > 0 ? r.matches / games : 0,
          kda: (r.total_kills + r.total_assists) / Math.max(1, r.total_deaths),
          avgNetWorth: r.total_net_worth / r.matches,
          avgDamage: r.total_player_damage / r.matches,
        },
      ]),
  );
}

export const ROLE_LABELS: Record<string, string> = {
  marksman: "Marksman",
  mystic: "Mystic",
  brawler: "Brawler",
  assassin: "Assassin",
};
