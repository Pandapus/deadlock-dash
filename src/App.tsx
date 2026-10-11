import { useEffect, useState } from "react";
import { detectEnvironment, type Environment } from "./api/native";
import { ConsoleTail } from "./components/ConsoleTail";
import { LiveMatch } from "./components/LiveMatch";
import { RecentMatches } from "./components/RecentMatches";
import { SettingsDialog } from "./components/SettingsDialog";
import { useConsoleWatch, type GameState } from "./hooks/useConsoleWatch";
import { useHeroes } from "./hooks/useHeroes";
import { useSettings } from "./hooks/useSettings";
import type { ConsoleStatus } from "./api/native";

export default function App() {
  const [settings, updateSettings] = useSettings();
  const [env, setEnv] = useState<Environment | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const heroes = useHeroes();

  useEffect(() => {
    detectEnvironment()
      .then(setEnv)
      .catch((e) => console.error("Environment detection failed", e));
  }, []);

  const accountId = settings.accountId ?? env?.account?.account_id ?? null;
  const logPath = settings.consoleLogPath ?? env?.console_log_path ?? null;
  const { status, lines, game } = useConsoleWatch(logPath);

  return (
    <div className="app">
      <header className="topbar">
        <h1>Deadlock Dash</h1>
        <StatusPills status={status} game={game} />
        <button className="button" onClick={() => setShowSettings(true)}>
          Settings
        </button>
      </header>

      {accountId === null ? (
        <section className="panel panel--wide">
          <h2>Welcome</h2>
          <p>Couldn't detect your Steam account. Open Settings and enter your Steam profile.</p>
        </section>
      ) : (
        <main className="grid">
          <LiveMatch accountId={accountId} heroes={heroes} game={game} />
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
