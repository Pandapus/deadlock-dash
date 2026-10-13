import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Item, ItemSection } from "../api/types";
import type { ItemMap } from "../hooks/useItems";
import { formatCost } from "../lib/format";

const SECTION_LABELS: Record<ItemSection["kind"], string> = {
  innate: "Stats",
  active: "Active",
  passive: "Passive",
};

/**
 * Item icon that shows the full item card on hover/focus. With `withName` the
 * icon is drawn larger and the name next to it is part of the hover target.
 */
export function ItemIcon({ id, items, withName = false }: { id: number; items: ItemMap; withName?: boolean }) {
  const item = items.get(id);
  const ref = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const show = () => setAnchor(ref.current?.getBoundingClientRect() ?? null);
  const hide = () => setAnchor(null);
  const iconClass = `item item--${item?.item_slot_type ?? "unknown"}${withName ? " item--large" : ""}`;
  const image = item?.shop_image_small_webp ? <img src={item.shop_image_small_webp} alt="" /> : null;
  const card = anchor && (
    <FloatingCard anchor={anchor}>
      {item ? <ItemCard item={item} items={items} /> : <div className="item-card">Unknown item {id}</div>}
    </FloatingCard>
  );

  return (
    <span
      ref={ref}
      className={withName ? "item-entry" : iconClass}
      tabIndex={0}
      aria-label={item?.name ?? `Item ${id}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {withName ? (
        <>
          <span className={iconClass}>{image}</span>
          <span className="item-entry__name">{item?.name ?? `Item ${id}`}</span>
        </>
      ) : (
        image
      )}
      {card && createPortal(card, document.body)}
    </span>
  );
}

/** Positions its child next to `anchor`, flipping/clamping to stay on screen. */
function FloatingCard({ anchor, children }: { anchor: DOMRect; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const gap = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = anchor.right + gap;
    if (left + width > vw - gap) left = anchor.left - width - gap;
    left = Math.max(gap, Math.min(left, vw - width - gap));
    const top = Math.max(gap, Math.min(anchor.top, vh - height - gap));
    setPos({ left, top });
  }, [anchor]);

  return (
    <div
      ref={ref}
      className="item-card-float"
      role="tooltip"
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: "hidden" }}
    >
      {children}
    </div>
  );
}

export function ItemCard({ item, items }: { item: Item; items: ItemMap }) {
  const components = (item.component_items ?? [])
    .map((cls) => [...items.values()].find((i) => i.class_name === cls)?.name ?? cls)
    .join(", ");

  return (
    <div className={`item-card item-card--${item.item_slot_type ?? "unknown"}`}>
      <div className="item-card__head">
        <div>
          <div className="item-card__name">{item.name}</div>
          <div className="item-card__meta">
            {item.item_slot_type ? `${capitalize(item.item_slot_type)} · ` : ""}Tier {item.item_tier ?? "?"}
            {item.is_active_item ? " · Active" : ""}
          </div>
        </div>
        {item.cost !== undefined && <div className="item-card__cost">{formatCost(item.cost)}</div>}
      </div>
      {components && <div className="item-card__builds">Upgrades from {components}</div>}
      {item.sections.map((section, i) => (
        <div key={i} className={`item-card__section item-card__section--${section.kind}`}>
          <div className="item-card__section-title">{SECTION_LABELS[section.kind]}</div>
          {section.text && (
            <p className="item-card__text">
              <RichText html={section.text} />
            </p>
          )}
          {section.effects.length > 0 && (
            <div className="item-card__effects">
              {section.effects.map((e) => (
                <span key={e} className="tag tag--accent">
                  {e}
                </span>
              ))}
            </div>
          )}
          {section.stats.length > 0 && (
            <dl className="item-card__stats">
              {section.stats.map((stat, j) => (
                <div key={j} className={`item-stat item-stat--${stat.emphasis} ${stat.negative ? "item-stat--negative" : ""}`}>
                  <dt>
                    {stat.label}
                    {stat.condition && <span className="muted"> {stat.condition}</span>}
                  </dt>
                  <dd>{stat.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      ))}
      {item.sections.length === 0 && <p className="muted item-card__text">No stats listed.</p>}
    </div>
  );
}

/**
 * Renders the API's description markup as React nodes. Only text, line breaks
 * and highlight spans are kept, so no API-supplied HTML reaches the DOM.
 */
function RichText({ html }: { html: string }) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  return <>{toNodes(doc.body.childNodes)}</>;
}

function toNodes(nodes: NodeListOf<ChildNode>): ReactNode[] {
  return [...nodes].map((node, i) => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (!(node instanceof Element)) return null;
    const tag = node.tagName.toLowerCase();
    if (tag === "br") return <br key={i} />;
    const children = toNodes(node.childNodes);
    const cls = node.classList;
    if (cls.contains("diminish")) return <span key={i} className="rt-diminish">{children}</span>;
    if (cls.contains("highlight") || cls.contains("inline-attribute-label")) {
      return <span key={i} className="rt-highlight">{children}</span>;
    }
    return <span key={i}>{children}</span>;
  });
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
