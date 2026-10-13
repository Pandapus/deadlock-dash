import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getMatchHistory } from "../api/client";
import { DB_CHANGED_EVENT, playerProfile, type Profile } from "../api/native";

/** Several saves can land at once (e.g. scouting a full lobby); reload once. */
const RELOAD_DEBOUNCE_MS = 300;

/**
 * A player's profile from the local database. It shows what's stored right
 * away, then pulls their API match history in (which saves it) and reloads
 * whenever anything new is saved.
 */
export function useProfile(accountId: number, limit = 50) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      playerProfile(accountId, limit)
        .then((p) => {
          if (cancelled) return;
          setProfile(p);
          setError(null);
        })
        .catch((e) => !cancelled && setError(String(e)));

    setProfile(null);
    setRefreshError(null);
    load();
    const unlisten = listen(DB_CHANGED_EVENT, () => {
      clearTimeout(timer);
      timer = setTimeout(load, RELOAD_DEBOUNCE_MS);
    });
    getMatchHistory(accountId).catch((e) => !cancelled && setRefreshError(String(e)));

    return () => {
      cancelled = true;
      clearTimeout(timer);
      unlisten.then((fn) => fn());
    };
  }, [accountId, limit]);

  return { profile, error, refreshError };
}
