import { useCallback, useState } from "react";

export interface Settings {
  accountId: number | null;
  consoleLogPath: string | null;
}

const KEY = "deadlock-dash:settings";
const DEFAULTS: Settings = { accountId: null, consoleLogPath: null };

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(load);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // Storage unavailable; settings just won't persist.
      }
      return next;
    });
  }, []);

  return [settings, update] as const;
}
