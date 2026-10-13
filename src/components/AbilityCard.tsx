import { useState } from "react";
import {
  abilityValue,
  describeUpgrade,
  formatAbilityValue,
  formatNumber,
  tierUnlocking,
  type Ability,
  type AbilityContext,
  type AbilityRow,
} from "../lib/abilities";
import { RichText } from "./ItemTooltip";

/** Ability points each upgrade tier costs in game. */
const TIER_COST = [1, 2, 5];

/**
 * An ability's tooltip with live values: spirit power and boons come from the
 * page's level controls, upgrade tiers are picked per card.
 */
export function AbilityCard({ ability, slot, ctx }: { ability: Ability; slot: number; ctx: Omit<AbilityContext, "tier"> }) {
  const [tier, setTier] = useState(0);
  const full: AbilityContext = { ...ctx, tier };
  const value = (key: string) => abilityValue(ability, key, full);

  const header = ability.header.flatMap((key) => {
    const v = value(key);
    if (!v || v.off) return [];
    // Charges only matter when there's more than one.
    const charges = value("AbilityCharges");
    if ((key === "AbilityCharges" || key === "AbilityCooldownBetweenCharge") && (!charges || charges.total <= 1)) return [];
    return [{ key, label: ability.properties[key].label, text: formatAbilityValue(ability.properties[key], v.total), upgraded: v.upgraded }];
  });

  const sections = ability.sections.filter((s) => {
    if (!s.requires) return true;
    const v = value(s.requires);
    return v !== null && !v.off;
  });

  return (
    <article className={`ability ${ability.ultimate ? "ability--ultimate" : ""}`}>
      <header className="ability__head">
        <span className="ability__icon">{ability.image && <img src={ability.image} alt="" />}</span>
        <div>
          <div className="ability__slot">{ability.ultimate ? "Ultimate" : `Ability ${slot}`}</div>
          <h3 className="ability__name">{ability.name}</h3>
          {ability.quip && <div className="muted ability__quip">{ability.quip}</div>}
        </div>
      </header>

      {header.length > 0 && (
        <dl className="ability__chips">
          {header.map((h) => (
            <div key={h.key} className={`ability__chip ${h.upgraded ? "ability__chip--upgraded" : ""}`}>
              <dt>{h.label}</dt>
              <dd>{h.text}</dd>
            </div>
          ))}
        </dl>
      )}

      {sections.map((section, i) => {
        const unlockedBy = section.requires ? tierUnlocking(ability, section.requires) : undefined;
        const blocks = section.blocks
          .map((b) => ({ ...b, rows: b.rows.filter((r) => !(value(r.key)?.off ?? true)) }))
          .filter((b) => b.rows.length > 0);
        if (!section.text && blocks.length === 0) return null;
        return (
          <div key={i} className="ability__section">
            {unlockedBy && <span className="tag tag--accent">Unlocked by T{unlockedBy}</span>}
            {section.text && (
              <p className="ability__text">
                <RichText html={section.text} />
              </p>
            )}
            {blocks.map((b, j) => (
              <div key={j} className="ability__block">
                {b.title && <div className="ability__block-title">{b.title}</div>}
                {b.rows.map((row) => (
                  <ValueRow key={row.key} ability={ability} row={row} ctx={full} />
                ))}
              </div>
            ))}
          </div>
        );
      })}

      {ability.upgrades.length > 0 && (
        <div className="ability__upgrades">
          <div className="segmented" role="radiogroup" aria-label={`${ability.name} upgrades`}>
            {["Base", ...ability.upgrades.map((_, i) => `T${i + 1}`)].map((label, i) => (
              <button
                key={label}
                role="radio"
                aria-checked={tier === i}
                className={`tab ${tier === i ? "tab--active" : ""}`}
                onClick={() => setTier(i)}
              >
                {label}
              </button>
            ))}
          </div>
          <ol className="ability__tiers">
            {ability.upgrades.map((u, i) => (
              <li key={i} className={i < tier ? "ability__tier--on" : ""}>
                <span className="ability__tier-badge">
                  T{i + 1}
                  {TIER_COST[i] !== undefined && <small>{TIER_COST[i]} AP</small>}
                </span>
                <span>{u.text ? <RichText html={u.text} /> : describeUpgrade(ability, u)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </article>
  );
}

function ValueRow({ ability, row, ctx }: { ability: Ability; row: AbilityRow; ctx: AbilityContext }) {
  const prop = ability.properties[row.key];
  const v = abilityValue(ability, row.key, ctx);
  if (!v) return null;
  const spirit = prop.scale?.stat === "spirit";
  // Only a positive base and scaled part split into a meaningful bar.
  const showBar = v.scaled > 0 && v.base >= 0;
  const basePct = showBar ? (v.base / v.total) * 100 : 0;

  return (
    <div className={`ability-row ${prop.negative ? "ability-row--negative" : ""}`}>
      <span className="ability-row__label">{row.label ?? prop.label}</span>
      <span className="ability-row__value">
        {v.factor !== undefined && v.factor !== 0 && (
          <span className={`scale-chip ${spirit ? "scale-chip--spirit" : ""}`} title={`Adds ${formatNumber(v.factor)} per point of ${prop.scale?.statName ?? "the stat"}`}>
            ×{formatNumber(v.factor)} {prop.scale?.statName}
          </span>
        )}
        <span className={v.upgraded ? "ability-row__num--upgraded" : undefined}>{formatAbilityValue(prop, v.total)}</span>
      </span>
      {showBar && (
        <span
          className="ability-row__bar"
          role="img"
          aria-label={`${formatNumber(v.base)} base plus ${formatNumber(v.scaled)} from ${prop.scale?.statName}`}
          title={`${formatNumber(v.base)} base + ${formatNumber(v.scaled)} from ${prop.scale?.statName}`}
        >
          <span className="ability-row__bar-base" style={{ width: `${basePct}%` }} />
          <span className={`ability-row__bar-scaled ${spirit ? "ability-row__bar-scaled--spirit" : ""}`} style={{ width: `${100 - basePct}%` }} />
        </span>
      )}
    </div>
  );
}
