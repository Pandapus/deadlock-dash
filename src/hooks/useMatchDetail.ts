import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { DB_CHANGED_EVENT, matchDetail, type MatchDetail } from "../api/native";

const RELOAD_DEBOUNCE_MS = 300;

/**
 * One match from the local database, reloaded whenever anything new is saved
 * (a match still being played keeps filling in). `detail` is null while
 * loading and when the match isn't saved; `missing` tells the two apart.
 */
export function useMatchDetail(matchId: number) {
  const [detail, setDetail] = useState<MatchDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      matchDetail(matchId)
        .then((d) => {
          if (cancelled) return;
          setDetail(d);
          setMissing(d === null);
          setError(null);
        })
        .catch((e) => !cancelled && setError(String(e)));

    setDetail(null);
    setMissing(false);
    load();
    const unlisten = listen(DB_CHANGED_EVENT, () => {
      clearTimeout(timer);
      timer = setTimeout(load, RELOAD_DEBOUNCE_MS);
    });

    return () => {
      cancelled = true;
      clearTimeout(timer);
      unlisten.then((fn) => fn());
    };
  }, [matchId]);

  return { detail, missing, error };
}
