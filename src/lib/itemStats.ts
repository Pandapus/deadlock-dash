// Turns the raw upgrade payload into the tooltip model the UI renders. The raw
// shape is large (~2 MB for all items), so only the tooltip-relevant parts are
// kept once the list is loaded.
import type { Item, ItemSection, ItemStat } from "../api/types";

interface RawProperty {
  value?: string | number;
  label?: string;
  prefix?: string;
  postfix?: string;
  disable_value?: string;
  conditional?: string;
  negative_attribute?: boolean;
}

interface RawSectionAttribute {
  loc_string?: string;
  properties?: string[];
  elevated_properties?: string[];
  important_properties?: string[];
  important_properties_with_icon?: { name: string; localized_name?: string }[];
}

export interface RawItem {
  id: number;
  name: string;
  class_name?: string;
  item_slot_type?: string;
  item_tier?: number;
  cost?: number;
  shopable?: boolean;
  disabled?: boolean;
  is_active_item?: boolean;
  component_items?: string[];
  shop_image_small_webp?: string;
  shop_image_webp?: string;
  image_webp?: string;
  description?: Record<string, string>;
  properties?: Record<string, RawProperty>;
  tooltip_sections?: { section_type?: string; section_attributes: RawSectionAttribute[] }[];
}

export function toItem(raw: RawItem): Item {
  const properties = raw.properties ?? {};
  const sections: ItemSection[] = [];
  for (const section of raw.tooltip_sections ?? []) {
    const kind = section.section_type === "innate" || section.section_type === "active" ? section.section_type : "passive";
    for (const attr of section.section_attributes) {
      const stats = [
        ...statList(properties, attr.important_properties, "important"),
        ...statList(properties, attr.elevated_properties, "elevated"),
        ...statList(properties, attr.properties, "normal"),
      ];
      const effects = (attr.important_properties_with_icon ?? []).map((e) => e.localized_name ?? humanize(e.name));
      const text = attr.loc_string ? stripIcons(attr.loc_string) : undefined;
      if (text || stats.length || effects.length) sections.push({ kind, text, stats, effects });
    }
  }
  // A few items carry their description only at the top level.
  const desc = raw.description?.desc;
  if (desc && !sections.some((s) => s.text)) {
    sections.push({ kind: raw.is_active_item ? "active" : "passive", text: stripIcons(desc), stats: [], effects: [] });
  }

  return {
    id: raw.id,
    name: raw.name,
    class_name: raw.class_name,
    item_slot_type: raw.item_slot_type,
    item_tier: raw.item_tier,
    cost: raw.cost,
    shopable: raw.shopable === true && raw.disabled !== true,
    is_active_item: raw.is_active_item,
    component_items: raw.component_items,
    shop_image_small_webp: raw.shop_image_small_webp ?? raw.shop_image_webp ?? raw.image_webp,
    sections,
  };
}

function statList(
  properties: Record<string, RawProperty>,
  keys: string[] | undefined,
  emphasis: ItemStat["emphasis"],
): ItemStat[] {
  const stats: ItemStat[] = [];
  for (const key of keys ?? []) {
    const prop = properties[key];
    const value = prop && formatValue(prop);
    if (!prop || value === null) continue;
    stats.push({
      label: prop.label || humanize(key),
      value,
      emphasis,
      condition: prop.conditional,
      negative: prop.negative_attribute === true,
    });
  }
  return stats;
}

/** `null` = the property is switched off for this item (zero / disable value). */
export function formatValue(prop: RawProperty): string | null {
  const raw = String(prop.value ?? "").trim();
  if (raw === "" || raw === prop.disable_value) return null;
  const n = parseFloat(raw);
  if (Number.isNaN(n)) return raw;
  if (n === 0) return null;

  // `{s:sign}` means "show + for positives"; a literal +/- replaces the sign.
  let sign = n < 0 ? "-" : "";
  if (prop.prefix === "{s:sign}" && n > 0) sign = "+";
  else if (prop.prefix === "+" || prop.prefix === "-") sign = prop.prefix;

  // Some values embed their unit ("40m"); the postfix is authoritative when present.
  const unit = prop.postfix ?? raw.replace(/^-?[\d.]+/, "");
  return `${sign}${Math.abs(n)}${unit}`;
}

function humanize(key: string): string {
  return key
    .replace(/^StatusEffect/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
}

/** Inline SVG/IMG icons are large and add nothing once rendered as text. */
function stripIcons(html: string): string {
  return html
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<img[^>]*>/gi, "")
    .trim();
}
