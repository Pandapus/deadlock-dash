import { useEffect, useState } from "react";
import { detectEnvironment, type Environment } from "./api/native";
import { ConsoleTail } from "./components/ConsoleTail";
import { HeroesPage } from "./components/HeroesPage";
import { ItemsPage } from "./components/ItemsPage";
import { LiveMatch } from "./components/LiveMatch";
import { LiveScoreboard } from "./components/LiveScoreboard";
import { MatchReportPanel } from "./components/MatchReportPanel";
import { ProfilePage } from "./components/ProfilePage";
import { RecentMatches } from "./components/RecentMatches";
import { SettingsDialog } from "./components/SettingsDialog";
import { TimersPanel } from "./components/TimersPanel";
import { useConsoleWatch, type GameState } from "./hooks/useConsoleWatch";
import { useHeroes } from "./hooks/useHeroes";
import { useItems } from "./hooks/useItems";
import { useLiveFeed } from "./hooks/useLiveFeed";
import { useSettings } from "./hooks/useSettings";
import { useTimers } from "./hooks/useTimers";
import type { ConsoleStatus } from "./api/native";

const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "profile", label: "Profile" },
  { id: "heroes", label: "Heroes" },
  { id: "items", label: "Items" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default function App() {
  const [settings, updateSettings] = useSettings();
  const [env, setEnv] = useState<Environment | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [tab, setTab] = useState<Tab>("dashboard");
  const heroes = useHeroes();
  const items = useItems();

  useEffect(() => {
    detectEnvironment()
      .then(setEnv)
      .catch((e) => console.error("Environment detection failed", e));
  }, []);

  const accountId = settings.accountId ?? env?.account?.account_id ?? null;
  const logPath = settings.consoleLogPath ?? env?.console_log_path ?? null;
  const { status, lines, game, report } = useConsoleWatch(logPath, accountId);
  const { live, stop } = useLiveFeed(report);
  const timers = useTimers(report, live, settings.timers);

  return (
    <div className="app">
      <header className="topbar">
        <h1>Deadlock Dash</h1>
        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`tab ${tab === t.id ? "tab--active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <StatusPills status={status} game={game} />
        <button className="button" onClick={() => setShowSettings(true)}>
          Settings
        </button>
      </header>

      {tab === "heroes" ? (
        <main className="grid">
          <HeroesPage items={items} />
        </main>
      ) : tab === "items" ? (
        <main className="grid">
          <ItemsPage items={items} />
        </main>
      ) : accountId === null ? (
        <section className="panel panel--wide">
          <h2>Welcome</h2>
          <p>Couldn't detect your Steam account. Open Settings and enter your Steam profile.</p>
        </section>
      ) : tab === "profile" ? (
        <main className="grid">
          <ProfilePage selfId={accountId} heroes={heroes} />
        </main>
      ) : (
        <main className="grid">
          {live ? (
            <LiveScoreboard live={live} accountId={accountId} heroes={heroes} items={items} onStop={stop} />
          ) : (
            <LiveMatch accountId={accountId} heroes={heroes} game={game} />
          )}
          {(report?.phase === "intro" || report?.phase === "in_progress") && (
            <TimersPanel {...timers} prefs={settings.timers} onPrefs={(t) => updateSettings({ timers: t })} />
          )}
          <MatchReportPanel report={report} heroes={heroes} />
          <RecentMatches accountId={accountId} heroes={heroes} />
          <ConsoleTail lines={lines} status={status} />
        </main>
      )}

      {showSettings && (
        <SettingsDialog
          settings={settings}
          env={env}
          onSave={updateSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

function StatusPills({ status, game }: { status: ConsoleStatus | null; game: GameState }) {
  const consoleLabel =
    status?.state === "watching" ? "Console: watching" : status?.state === "error" ? "Console: error" : "Console: waiting";
  const gameLabel =
    game.phase === "in_game" ? `In game${game.map ? ` · ${game.map}` : ""}` : game.phase === "menus" ? "In menus" : "Game: unknown";
  return (
    <div className="status-pills">
      <span className={`pill ${status?.state === "watching" ? "pill--good" : ""}`}>{consoleLabel}</span>
      <span className="pill">{gameLabel}</span>
    </div>
  );
}
