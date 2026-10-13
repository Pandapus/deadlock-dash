import { useEffect, useState } from "react";
import { getHeroAbilities, getHeroMeta, getHeroProfiles, getWeapons } from "../api/client";
import type { Ability } from "../lib/abilities";
import type { HeroMeta, HeroProfile, Weapon } from "../lib/heroStats";

export interface HeroRoster {
  heroes: HeroProfile[];
  weapons: Map<string, Weapon>;
  /** Empty when analytics failed to load; the page still works without it. */
  meta: Map<number, HeroMeta>;
  loading: boolean;
  error: string | null;
}

/** Every hero with its gun and recent win/pick rates, for the Heroes tab. */
export function useHeroRoster(): HeroRoster {
  const [state, setState] = useState<HeroRoster>({
    heroes: [],
    weapons: new Map(),
    meta: new Map(),
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    Promise.all([getHeroProfiles(), getWeapons()])
      .then(([heroes, weapons]) => {
        if (cancelled) return;
        heroes.sort((a, b) => a.name.localeCompare(b.name));
        setState((s) => ({ ...s, heroes, weapons, loading: false }));
      })
      .catch((e) => !cancelled && setState((s) => ({ ...s, loading: false, error: String(e) })));
    getHeroMeta()
      .then((meta) => !cancelled && setState((s) => ({ ...s, meta })))
      .catch((e) => console.error("Failed to load hero analytics", e));
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

export function useHeroAbilities(heroId: number) {
  const [abilities, setAbilities] = useState<Map<string, Ability> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setAbilities(null);
    setError(null);
    getHeroAbilities(heroId)
      .then((a) => !cancelled && setAbilities(a))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [heroId]);

  return { abilities, error };
}
