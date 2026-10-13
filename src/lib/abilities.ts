// Hero abilities from GET /v1/assets/items/by-hero-id/{id}, reduced to the
// tooltip layout plus what's needed to recompute values for a given spirit
// power, boon count and upgrade tier.
import { humanize, stripIcons } from "./itemStats";

interface RawScaleFunction {
  class_name?: string;
  specific_stat_scale_type?: string;
  stat_scale?: number;
}

interface RawAbilityProperty {
  value?: string | number;
  label?: string;
  prefix?: string;
  postfix?: string;
  disable_value?: string;
  negative_attribute?: boolean;
  scale_function?: RawScaleFunction;
}

interface RawTooltipProperty {
  important_property?: string;
  status_effect_value?: string;
  status_effect_name?: string;
}

interface RawInfoSection {
  loc_string?: string;
  properties_block?: { loc_string?: string; properties?: RawTooltipProperty[] }[];
  basic_properties?: string[];
  property_upgrade_required?: string;
}

interface RawPropertyUpgrade {
  name: string;
  bonus: string | number;
  upgrade_type?: string;
}

export interface RawAbility {
  id: number;
  class_name: string;
  name: string;
  type?: string;
  ability_type?: string;
  image_webp?: string;
  image?: string;
  description?: Record<string, string | undefined>;
  properties?: Record<string, RawAbilityProperty>;
  tooltip_details?: { info_sections?: RawInfoSection[]; additional_header_properties?: string[] };
  upgrades?: { property_upgrades?: RawPropertyUpgrade[] }[];
}

/** What a property's scaling part multiplies. */
export type ScaleStat = "spirit" | "boons" | "other";

export interface AbilityProperty {
  label: string;
  base: number;
  unit: string;
  /** "+" shows a plus on positive values; "-" forces a minus. */
  sign?: "+" | "-";
  /** Value that means "switched off", e.g. -1 charges. */
  disabled?: number;
  negative: boolean;
  scale?: { stat: ScaleStat; factor: number; statName: string };
}

export interface UpgradeChange {
  key: string;
  bonus: number;
  mode: "add" | "addScale" | "mulBase" | "mulScale";
}

export interface AbilityUpgrade {
  /** Description markup, when the API has one for this tier. */
  text?: string;
  changes: UpgradeChange[];
}

export interface AbilityRow {
  key: string;
  /** Overrides the property label, e.g. a status effect's name. */
  label?: string;
}

export interface AbilitySection {
  text?: string;
  blocks: { title?: string; rows: AbilityRow[] }[];
  /** Only applies once an upgrade gives this property a value. */
  requires?: string;
}

export interface Ability {
  id: number;
  className: string;
  name: string;
  ultimate: boolean;
  image?: string;
  quip?: string;
  header: string[];
  sections: AbilitySection[];
  properties: Record<string, AbilityProperty>;
  upgrades: AbilityUpgrade[];
}

/** Shown in the card header rather than in the body. */
const HEADER_KEYS = ["AbilityCooldown", "AbilityCharges", "AbilityCooldownBetweenCharge", "AbilityCastRange", "AbilityDuration"];

export function toAbility(raw: RawAbility): Ability {
  const properties: Record<string, AbilityProperty> = {};
  for (const [key, prop] of Object.entries(raw.properties ?? {})) {
    const parsed = toProperty(key, prop);
    if (parsed) properties[key] = parsed;
  }

  const sections: AbilitySection[] = (raw.tooltip_details?.info_sections ?? []).map((s) => ({
    text: s.loc_string ? stripIcons(s.loc_string) : undefined,
    requires: s.property_upgrade_required,
    blocks: [
      ...(s.properties_block ?? []).map((b) => ({
        title: b.loc_string,
        rows: (b.properties ?? []).flatMap((p): AbilityRow[] => {
          const key = p.important_property && properties[p.important_property] ? p.important_property : p.status_effect_value;
          if (!key || !properties[key]) return [];
          return [{ key, label: key === p.status_effect_value && p.status_effect_name ? p.status_effect_name : undefined }];
        }),
      })),
      { rows: (s.basic_properties ?? []).filter((k) => properties[k]).map((key) => ({ key })) },
    ],
  }));
  const desc = raw.description?.desc;
  if (desc && !sections.some((s) => s.text)) sections.unshift({ text: stripIcons(desc), blocks: [] });

  return {
    id: raw.id,
    className: raw.class_name,
    name: raw.name,
    ultimate: raw.ability_type === "ultimate",
    image: raw.image_webp ?? raw.image,
    quip: raw.description?.quip,
    header: [...HEADER_KEYS, ...(raw.tooltip_details?.additional_header_properties ?? [])].filter((k) => properties[k]),
    sections,
    properties,
    upgrades: (raw.upgrades ?? []).map((u, i) => {
      const text = raw.description?.[`t${i + 1}_desc`];
      return {
        text: text ? stripIcons(text) : undefined,
        changes: (u.property_upgrades ?? []).map((c) => ({
          key: c.name,
          bonus: parseFloat(String(c.bonus)) || 0,
          mode:
            c.upgrade_type === "EAddToScale"
              ? "addScale"
              : c.upgrade_type === "EMultiplyBase"
                ? "mulBase"
                : c.upgrade_type === "EMultiplyScale"
                  ? "mulScale"
                  : "add",
        })),
      };
    }),
  };
}

function toProperty(key: string, prop: RawAbilityProperty): AbilityProperty | null {
  const raw = String(prop.value ?? "").trim();
  const base = parseFloat(raw);
  if (Number.isNaN(base)) return null;
  const sf = prop.scale_function;
  let scale: AbilityProperty["scale"];
  if (sf?.stat_scale) {
    const type = sf.specific_stat_scale_type;
    // Damage/heal scale functions without an explicit stat scale with spirit power.
    const stat: ScaleStat = !type || type === "ETechPower" ? "spirit" : type === "ELevelUpBoons" ? "boons" : "other";
    scale = { stat, factor: sf.stat_scale, statName: statName(type) };
  }
  const disabled = prop.disable_value !== undefined ? parseFloat(prop.disable_value) : undefined;
  return {
    label: prop.label || humanize(key),
    base,
    unit: prop.postfix ?? raw.replace(/^-?[\d.]+/, ""),
    sign: prop.prefix === "{s:sign}" || prop.prefix === "+" ? "+" : prop.prefix === "-" ? "-" : undefined,
    disabled: Number.isNaN(disabled) ? undefined : disabled,
    negative: prop.negative_attribute === true,
    scale,
  };
}

export interface AbilityValue {
  /** Base part after upgrades. */
  base: number;
  /** Part contributed by spirit power (or boons). */
  scaled: number;
  total: number;
  /** Scaling factor after upgrades, if any. */
  factor?: number;
  /** An applied upgrade touched this property. */
  upgraded: boolean;
  /** The value is the property's "off" value or zero; such rows are hidden. */
  off: boolean;
}

export interface AbilityContext {
  /** Upgrade tiers applied, 0–3. */
  tier: number;
  spiritPower: number;
  boons: number;
}

export function abilityValue(ability: Ability, key: string, ctx: AbilityContext): AbilityValue | null {
  const prop = ability.properties[key];
  if (!prop) return null;
  let base = prop.base;
  let factor = prop.scale?.factor ?? 0;
  let upgraded = false;
  for (const upgrade of ability.upgrades.slice(0, ctx.tier)) {
    for (const c of upgrade.changes) {
      if (c.key !== key) continue;
      upgraded = true;
      if (c.mode === "add") base += c.bonus;
      else if (c.mode === "mulBase") base *= c.bonus;
      else if (c.mode === "addScale") factor += c.bonus;
      else factor *= c.bonus;
    }
  }
  const statValue = prop.scale?.stat === "spirit" ? ctx.spiritPower : prop.scale?.stat === "boons" ? ctx.boons : 0;
  const scaled = factor * statValue;
  const total = base + scaled;
  return {
    base,
    scaled,
    total,
    factor: prop.scale || factor ? factor : undefined,
    upgraded,
    off: total === 0 || (prop.disabled !== undefined && base === prop.disabled),
  };
}

export function formatAbilityValue(prop: AbilityProperty, n: number): string {
  const sign = prop.sign === "-" ? "-" : n < 0 ? "-" : prop.sign === "+" ? "+" : "";
  return `${sign}${formatNumber(Math.abs(n))}${prop.unit}`;
}

/** Up to two decimals for small values, fewer as they grow. */
export function formatNumber(n: number): string {
  const digits = Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : 2;
  return String(Number(n.toFixed(digits)));
}

/** Plain-text summary of an upgrade tier, for tiers the API has no description for. */
export function describeUpgrade(ability: Ability, upgrade: AbilityUpgrade): string {
  return upgrade.changes
    .map((c) => {
      const prop = ability.properties[c.key];
      const label = prop?.label ?? humanize(c.key);
      if (c.mode === "addScale") return `+${formatNumber(c.bonus)} ${prop?.scale?.statName ?? "spirit"} scaling on ${label}`;
      if (c.mode === "mulBase" || c.mode === "mulScale") return `×${formatNumber(c.bonus)} ${label}`;
      const unit = prop?.unit ?? "";
      return `${c.bonus > 0 ? "+" : "-"}${formatNumber(Math.abs(c.bonus))}${unit} ${label}`;
    })
    .join(", ");
}

/** Which upgrade tier (1-based) first gives `key` a value, if any. */
export function tierUnlocking(ability: Ability, key: string): number | undefined {
  const i = ability.upgrades.findIndex((u) => u.changes.some((c) => c.key === key));
  return i >= 0 ? i + 1 : undefined;
}

function statName(type: string | undefined): string {
  switch (type) {
    case undefined:
    case "ETechPower":
      return "spirit";
    case "ELevelUpBoons":
      return "boon";
    case "ELightMeleeDamage":
    case "EHeavyMeleeDamage":
      return "melee";
    case "EBaseWeaponDamageIncrease":
    case "EWeaponPower":
    case "EBulletDamage":
      return "weapon";
    default:
      return humanize(type.replace(/^E/, "")).toLowerCase();
  }
}
