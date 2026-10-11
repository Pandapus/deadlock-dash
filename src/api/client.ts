import { invoke } from "@tauri-apps/api/core";
import type { ActiveMatch, Hero, MatchHistoryEntry, SteamProfile } from "./types";

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

export function getHeroes(): Promise<Hero[]> {
  return cached("heroes", 60 * MINUTE, () =>
    apiGet<Hero[]>("/v1/assets/heroes", { only_active: true }),
  );
}

export function getMatchHistory(accountId: number): Promise<MatchHistoryEntry[]> {
  return cached(`history:${accountId}`, 5 * MINUTE, () =>
    apiGet<MatchHistoryEntry[]>(`/v1/players/${accountId}/match-history`),
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
