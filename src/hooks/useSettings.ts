import { useCallback, useState } from "react";
import type { TimerKind } from "../lib/timers";

export interface TimerPrefs {
  /** Missing kinds fall back to their default (see TIMER_KINDS). */
  enabled: Partial<Record<TimerKind, boolean>>;
  voice: boolean;
  /** Seconds of warning before a spawn. */
  lead: number;
}

export interface Settings {
  accountId: number | null;
  consoleLogPath: string | null;
  timers: TimerPrefs;
}

const KEY = "deadlock-dash:settings";
const DEFAULTS: Settings = {
  accountId: null,
  consoleLogPath: null,
  timers: { enabled: {}, voice: true, lead: 20 },
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const saved = JSON.parse(raw);
    return { ...DEFAULTS, ...saved, timers: { ...DEFAULTS.timers, ...saved.timers } };
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
