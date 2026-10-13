import { useEffect, useState } from "react";
import { detectEnvironment, type Environment } from "./api/native";
import { ConsoleTail } from "./components/ConsoleTail";
import { HeroesPage } from "./components/HeroesPage";
import { ItemsPage } from "./components/ItemsPage";
import { LiveMatch } from "./components/LiveMatch";
import { LiveScoreboard } from "./components/LiveScoreboard";
import { MatchPage } from "./components/MatchPage";
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
  // A match opened from a match list, seen from `accountId`'s side. It covers
  // the tabs without unmounting them, so Back returns to the same scroll and state.
  const [openMatch, setOpenMatch] = useState<{ matchId: number; accountId: number } | null>(null);
  // Players opened in the Profile tab after your own, so Back can retrace them.
  const [profileTrail, setProfileTrail] = useState<number[]>([]);
  const heroes = useHeroes();
  const items = useItems();

  useEffect(() => {
    detectEnvironment()
      .then(setEnv)
      .catch((e) => console.error("Environment detection failed", e));
  }, []);

  const accountId = settings.accountId ?? env?.account?.account_id ?? null;
  useEffect(() => setProfileTrail([]), [accountId]);
  const logPath = settings.consoleLogPath ?? env?.console_log_path ?? null;
  const { status, lines, game, report } = useConsoleWatch(logPath, accountId);
  const { live, stop } = useLiveFeed(report);
  const timers = useTimers(report, live, settings.timers);

  const openPlayer = (id: number) => {
    setProfileTrail((t) => (id === accountId ? [] : t.at(-1) === id ? t : [...t, id]));
    setTab("profile");
    setOpenMatch(null);
    window.scrollTo(0, 0);
  };
  const showMatch = (matchId: number, perspective: number) => {
    setOpenMatch({ matchId, accountId: perspective });
    window.scrollTo(0, 0);
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1>Deadlock Dash</h1>
        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id && !openMatch}
              className={`tab ${tab === t.id && !openMatch ? "tab--active" : ""}`}
              onClick={() => {
                setTab(t.id);
                setOpenMatch(null);
              }}
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

      {openMatch && accountId !== null && (
        <main className="grid">
          <MatchPage
            key={openMatch.matchId}
            matchId={openMatch.matchId}
            accountId={openMatch.accountId}
            selfId={accountId}
            heroes={heroes}
            items={items}
            onBack={() => setOpenMatch(null)}
            onOpenPlayer={openPlayer}
          />
        </main>
      )}

      <div className="tab-content" hidden={openMatch !== null}>
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
            <ProfilePage
              selfId={accountId}
              heroes={heroes}
              trail={profileTrail}
              onOpenPlayer={openPlayer}
              onBack={() => setProfileTrail((t) => t.slice(0, -1))}
              onOpenMatch={showMatch}
            />
          </main>
        ) : (
          <main className="grid">
            {live ? (
              <LiveScoreboard
                live={live}
                accountId={accountId}
                heroes={heroes}
                items={items}
                map={report?.match_id === live.match_id ? report.map : null}
                onStop={stop}
              />
            ) : (
              <LiveMatch accountId={accountId} heroes={heroes} game={game} />
            )}
            {(report?.phase === "intro" || report?.phase === "in_progress") && (
              <TimersPanel {...timers} prefs={settings.timers} onPrefs={(t) => updateSettings({ timers: t })} />
            )}
            <MatchReportPanel report={report} heroes={heroes} />
            <RecentMatches accountId={accountId} heroes={heroes} onOpenMatch={(id) => showMatch(id, accountId)} />
            <ConsoleTail lines={lines} status={status} />
          </main>
        )}
      </div>

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
