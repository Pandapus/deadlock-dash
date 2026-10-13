import { useMemo, useState } from "react";
import type { Item } from "../api/types";
import type { ItemMap } from "../hooks/useItems";
import { formatCost } from "../lib/format";
import { ItemIcon } from "./ItemTooltip";

const SLOTS = [
  { id: "weapon", label: "Gun" },
  { id: "vitality", label: "Vitality" },
  { id: "spirit", label: "Spirit" },
] as const;

/** The shop, laid out like in game: one column per slot, one row per tier. */
export function ItemsPage({ items }: { items: ItemMap }) {
  const [query, setQuery] = useState("");

  const tiers = useMemo(() => {
    const byTier = new Map<number, Item[]>();
    for (const item of items.values()) {
      if (!item.shopable || item.item_tier === undefined) continue;
      const list = byTier.get(item.item_tier) ?? [];
      list.push(item);
      byTier.set(item.item_tier, list);
    }
    return [...byTier.entries()]
      .sort(([a], [b]) => a - b)
      .map(([tier, list]) => ({ tier, cost: commonCost(list), items: list.sort((a, b) => a.name.localeCompare(b.name)) }));
  }, [items]);

  const needle = query.trim().toLowerCase();
  const matches = (item: Item) => !needle || item.name.toLowerCase().includes(needle);

  return (
    <section className="panel panel--wide">
      <header className="panel__header">
        <h2>Items</h2>
        <input
          className="input input--small"
          placeholder="Filter by name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </header>
      {items.size === 0 && <p className="muted">Loading…</p>}
      {tiers.length > 0 && (
        <div className="shop">
          <div className="shop__corner" />
          {SLOTS.map((slot) => (
            <h3 key={slot.id} className={`shop__slot shop__slot--${slot.id}`}>
              {slot.label}
            </h3>
          ))}
          {tiers.map(({ tier, cost, items: tierItems }) => (
            <TierRow key={tier} tier={tier} cost={cost} tierItems={tierItems} all={items} matches={matches} />
          ))}
        </div>
      )}
    </section>
  );
}

function TierRow(props: { tier: number; cost?: number; tierItems: Item[]; all: ItemMap; matches: (i: Item) => boolean }) {
  return (
    <>
      <div className="shop__tier">
        <span>Tier {props.tier}</span>
        {props.cost !== undefined && <span className="muted">{formatCost(props.cost)}</span>}
      </div>
      {SLOTS.map((slot) => {
        const list = props.tierItems.filter((i) => i.item_slot_type === slot.id && props.matches(i));
        return (
          <div key={slot.id} className="shop__cell">
            {list.map((item) => (
              <ItemIcon key={item.id} id={item.id} items={props.all} withName />
            ))}
          </div>
        );
      })}
    </>
  );
}

/** Items in a tier share a price; take the most common one in case of strays. */
function commonCost(list: Item[]): number | undefined {
  const counts = new Map<number, number>();
  for (const i of list) if (i.cost !== undefined) counts.set(i.cost, (counts.get(i.cost) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}
