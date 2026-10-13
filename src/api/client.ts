import { invoke } from "@tauri-apps/api/core";
import { toAbility, type Ability, type RawAbility } from "../lib/abilities";
import { toHeroMeta, toHeroProfile, toWeapon, type HeroMeta, type HeroProfile, type RawHero, type RawHeroAnalytics, type RawWeapon, type Weapon } from "../lib/heroStats";
import { toItem, type RawItem } from "../lib/itemStats";
import type { ActiveMatch, Hero, Item, MatchHistoryEntry, SteamProfile } from "./types";

type Query = Record<string, string | number | boolean | undefined>;

/** Calls deadlock-api.com through the Rust proxy (see src-tauri/src/api.rs). */
export function apiGet<T>(path: string, query: Query = {}): Promise<T> {
  const pairs = Object.entries(query)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => [k, String(v)]);
  return invoke<T>("api_get", { path, query: pairs });
}

const cache = new Map<string, { expires: number; value: Promise<unknown> }>();

/** Memoises a request for `ttlMs`; failed requests are evicted immediately. */
function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as Promise<T>;
  const value = load();
  cache.set(key, { expires: Date.now() + ttlMs, value });
  value.catch(() => cache.delete(key));
  return value;
}

const MINUTE = 60_000;

function getRawHeroes(): Promise<RawHero[]> {
  return cached("heroes", 60 * MINUTE, () =>
    apiGet<RawHero[]>("/v1/assets/heroes", { only_active: true }),
  );
}

export function getHeroes(): Promise<Hero[]> {
  return getRawHeroes();
}

/** Full hero details for the Heroes tab, from the same cached response as getHeroes. */
export function getHeroProfiles(): Promise<HeroProfile[]> {
  return getRawHeroes().then((list) => list.map(toHeroProfile));
}

/** Hero guns keyed by class name (a hero's `weaponClass`). */
export function getWeapons(): Promise<Map<string, Weapon>> {
  return cached("weapons", 60 * MINUTE, async () => {
    const list = await apiGet<RawWeapon[]>("/v1/assets/items/by-type/weapon");
    const map = new Map<string, Weapon>();
    for (const raw of list) {
      const weapon = toWeapon(raw);
      if (weapon) map.set(raw.class_name, weapon);
    }
    return map;
  });
}

/** A hero's four abilities, keyed by class name. */
export function getHeroAbilities(heroId: number): Promise<Map<string, Ability>> {
  return cached(`abilities:${heroId}`, 60 * MINUTE, async () => {
    const list = await apiGet<RawAbility[]>(`/v1/assets/items/by-hero-id/${heroId}`);
    return new Map(list.filter((a) => a.type === "ability").map((a) => [a.class_name, toAbility(a)]));
  });
}

const HERO_META_DAYS = 7;

/** Win/pick rates over the last week, across all modes and ranks. */
export function getHeroMeta(): Promise<Map<number, HeroMeta>> {
  return cached("hero-meta", 30 * MINUTE, async () => {
    // Rounded to the hour so the API's own cache can serve repeat requests.
    const since = Math.floor(Date.now() / 3_600_000) * 3600 - HERO_META_DAYS * 86_400;
    const rows = await apiGet<RawHeroAnalytics[]>("/v1/analytics/hero-stats", { min_unix_timestamp: since });
    return toHeroMeta(rows);
  });
}

/** Shop items, slimmed down to what the UI shows (the full response is ~2 MB). */
export function getItems(): Promise<Map<number, Item>> {
  return cached("items", 60 * MINUTE, async () => {
    const list = await apiGet<RawItem[]>("/v1/assets/items/by-type/upgrade");
    return new Map(list.map((raw) => [raw.id, toItem(raw)]));
  });
}

/** Also saves the history to the local database (see src-tauri/src/db.rs). */
export function getMatchHistory(accountId: number): Promise<MatchHistoryEntry[]> {
  return cached(`history:${accountId}`, 5 * MINUTE, () =>
    invoke<MatchHistoryEntry[]>("fetch_match_history", { accountId }),
  );
}

/** The API itself caches this for 60s, so polling faster is pointless. */
export function getActiveMatches(accountIds: number[]): Promise<ActiveMatch[]> {
  return apiGet<ActiveMatch[]>("/v1/matches/active", { account_ids: accountIds.join(",") });
}

export async function getSteamProfiles(accountIds: number[]): Promise<SteamProfile[]> {
  if (accountIds.length === 0) return [];
  const key = [...accountIds].sort((a, b) => a - b).join(",");
  return cached(`profiles:${key}`, 30 * MINUTE, () =>
    apiGet<SteamProfile[]>("/v1/players/steam", { account_ids: key }).catch((e) => {
      // 404 = none of these accounts have a stored profile.
      if (String(e).startsWith("404")) return [];
      throw e;
    }),
  );
}

export function searchSteamProfiles(query: string): Promise<SteamProfile[]> {
  return apiGet<SteamProfile[]>("/v1/players/steam-search", { search_query: query, limit: 10 });
}
