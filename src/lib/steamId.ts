const STEAMID64_OFFSET = 76561197960265728n;

/**
 * Accepts an account ID (SteamID3), a SteamID64, or a
 * steamcommunity.com/profiles/<id> URL. Returns null for anything else
 * (e.g. a persona name or vanity URL, which needs a search instead).
 */
export function parseAccountId(input: string): number | null {
  const raw = input.trim();
  const digits = raw.match(/steamcommunity\.com\/profiles\/(\d+)/)?.[1] ?? (/^\d+$/.test(raw) ? raw : null);
  if (!digits) return null;
  const value = BigInt(digits);
  const accountId = value >= STEAMID64_OFFSET ? value - STEAMID64_OFFSET : value;
  return accountId > 0n && accountId <= 0xffffffffn ? Number(accountId) : null;
}
