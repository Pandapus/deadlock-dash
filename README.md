# Deadlock Dash

A second-monitor companion app for [Deadlock](https://store.steampowered.com/app/1422450/Deadlock/), built with [Tauri 2](https://v2.tauri.app/) (Rust) and React + TypeScript.

![Preview with mock data](docs/preview.png)
<sub>Screenshot rendered with mock data.</sub>

> **Status: early scaffold.** It runs and shows real data from the public API. Parts of it are still guesses that need checking against the real game (see [Known gaps](#known-gaps)).

## What it does

| Panel | Source | Notes |
|---|---|---|
| **Live match** | [`/v1/matches/active`](https://api.deadlock-api.com/docs) from deadlock-api.com | Team souls, a soul-lead graph, both rosters, and a quick scouting line for every player (recent win rate, record on their current hero, most-played heroes). |
| **Recent matches** | `/v1/players/{account_id}/match-history` | Your last 15 games, plus win rate and KDA over the last 20. |
| **Console log** | `game/citadel/console.log` (needs the `-condebug` launch option) | Detects when you're in a game and shows the raw log with a filter. |

It also finds your Steam install, your Deadlock folder, and the Steam account you're logged into by reading Steam's config files (`libraryfolders.vdf`, `loginusers.vdf`).

### Fair-play rules this project follows

- **Never** reads or writes game memory, and never injects into the game process.
- **Never** captures or decrypts the game's network traffic.
- Uses only public data (the delayed spectator feed and match history) and files the game writes on purpose (`console.log`).

Valve delays the spectator feed to stop it being used for live advantage, so the app respects that delay.

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://rustup.rs/) (stable)
- The Tauri platform prerequisites: https://v2.tauri.app/start/prerequisites/. On Windows that means the Microsoft C++ Build Tools and WebView2 (WebView2 is already installed on Windows 10 and 11).

### Run

```sh
npm install
npm run tauri dev      # dev build with hot reload
npm run tauri build    # installer in src-tauri/target/release/bundle/
```

### Turn on the console log

In Steam, right-click **Deadlock → Properties → General → Launch Options** and add:

```
-condebug
```

The game then writes its console output to `…\steamapps\common\Deadlock\game\citadel\console.log`, and the app tails that file.

### Optional: API key

deadlock-api.com works without a key. If you have one, set the `DEADLOCK_API_KEY` environment variable before starting the app. It's sent as `X-API-KEY` from the Rust side only; frontend code never sees it.

## Project layout

```
src-tauri/src/
  lib.rs           Tauri commands: detect_environment, start/stop_console_watch, api_get
  steam.rs         Finds Steam, Deadlock and the logged-in account (with unit tests)
  console_log.rs   Tails console.log, emits lines and parsed game events (with unit tests)
  api.rs           Proxy to api.deadlock-api.com (no CORS issues, API key stays in Rust)
src/
  api/             Typed API client, response types, Tauri bridge types
  hooks/           Settings, hero list, console-watch state machine
  lib/             Formatting, stats aggregation, SteamID parsing
  components/      LiveMatch, NetWorthChart, RecentMatches, ConsoleTail, SettingsDialog
```

Checks:

```sh
npm run typecheck
cd src-tauri && cargo test && cargo clippy --all-targets
```

## Known gaps

1. **The live panel only works for some matches.** `/v1/matches/active` returns only the ~200 matches shown in the in-game **Watch** tab, so most of your own matches won't show up in it. The panel says so when that happens.
2. **The console.log patterns are guesses.** The regexes in `src-tauri/src/console_log.rs` (`parse_line`) are based on typical Source 2 output and haven't been checked against a real Deadlock log yet. Play a match with `-condebug` on, look through the Console panel (use the filter), and update the patterns and tests.
3. **Match history can be incomplete.** deadlock-api gets full history only for accounts that are friends with one of its bots. For other accounts it returns what it has stored. See their [ingest page](https://deadlock-api.com/ingest-cache).

## Roadmap

- **Live data for any match.** `GET /v1/matches/{match_id}/live/url` spectates a match and returns a broadcast URL. A Source 2 broadcast parser such as [haste](https://github.com/blukai/haste) (Rust, so it fits in `src-tauri`) can stream full match state from it: every player's souls, items, kills, objectives. Limits: 6 requests/hour per IP without an API key. The data is delayed like any spectator feed. The match ID would come from the console log (once gap 2 is fixed) or from the player's match history.
- **Post-match breakdown** from the replay file (`/v1/matches/{match_id}/metadata`, or demo parsing).
- Compact or always-on-top mode, a tray icon, and remembering window position per monitor.
- If Valve ever adds official Game State Integration (as in CS2 and Dota 2), switch the live panel to it.

## Credits

Data comes from the community [deadlock-api.com](https://deadlock-api.com) project. Deadlock Dash is not affiliated with or endorsed by Valve.
