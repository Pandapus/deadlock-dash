//! Local SQLite store: match history, player profiles and the players you've
//! met.
//!
//! Three sources feed it, and they disagree in quality:
//!
//! | Rank | Source | What it knows |
//! |---|---|---|
//! | 1 | `console.log` report | Only your matches; no result or scoreboard. The one first-party source. |
//! | 2 | Live broadcast | Every player's name, hero, K/D/A, souls, damage and items; result if watched to the end. |
//! | 3 | API match history | One player per match, with the authoritative result, stats and start time. |
//!
//! Each row remembers the best rank that wrote it. A write of equal or higher
//! rank wins on every value it has; a lower-ranked write only fills gaps. So
//! you can ingest in any order and get the same result.
//!
//! Teams are stored as 0 = Amber (Hidden King), 1 = Sapphire (Archmother),
//! matching the API. The broadcast's entity team numbers (2/3) are converted.
//!
//! Sync: every row carries `updated_at` and `synced_at` (unix seconds). A row
//! needs uploading when `synced_at IS NULL OR synced_at < updated_at`. The
//! `contribute` flag in `meta` is the user's opt-out; local storage happens
//! either way.

use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

use crate::live::LiveState;
use crate::match_report::{MatchPhase, MatchReport};

pub const EVENT_CHANGED: &str = "db://changed";

const RANK_CONSOLE: i64 = 1;
const RANK_LIVE: i64 = 2;
const RANK_HISTORY: i64 = 3;

/// Applied in order; `PRAGMA user_version` records how many have run.
const MIGRATIONS: &[&str] = &[
    r#"
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO meta (key, value) VALUES
  ('install_id', lower(hex(randomblob(16)))),
  ('contribute', '1');

CREATE TABLE players (
  account_id    INTEGER PRIMARY KEY,
  persona_name  TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  synced_at     INTEGER
);

CREATE TABLE matches (
  match_id      INTEGER PRIMARY KEY,
  source        INTEGER NOT NULL,
  start_time    INTEGER,
  duration_s    INTEGER,
  game_mode     INTEGER,
  match_mode    INTEGER,
  winning_team  INTEGER,
  build         INTEGER,
  map           TEXT,
  -- JSON [{clock, amber, sapphire}] from the live broadcast.
  souls_history TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  synced_at     INTEGER
);

CREATE TABLE match_players (
  match_id         INTEGER NOT NULL REFERENCES matches (match_id) ON DELETE CASCADE,
  account_id       INTEGER NOT NULL REFERENCES players (account_id),
  source           INTEGER NOT NULL,
  team             INTEGER,
  hero_id          INTEGER,
  level            INTEGER,
  net_worth        INTEGER,
  kills            INTEGER,
  deaths           INTEGER,
  assists          INTEGER,
  last_hits        INTEGER,
  denies           INTEGER,
  hero_damage      INTEGER,
  healing          INTEGER,
  objective_damage INTEGER,
  abandoned        INTEGER,
  -- JSON array of item ids in purchase order.
  items            TEXT,
  updated_at       INTEGER NOT NULL,
  synced_at        INTEGER,
  PRIMARY KEY (match_id, account_id)
);
CREATE INDEX match_players_account ON match_players (account_id, match_id);

-- Your own console.log report for a match.
CREATE TABLE match_reports (
  match_id   INTEGER PRIMARY KEY REFERENCES matches (match_id) ON DELETE CASCADE,
  account_id INTEGER,
  my_hero    TEXT,
  left_early INTEGER NOT NULL,
  deaths     INTEGER NOT NULL,
  ping_p50   INTEGER,
  fps_avg    REAL,
  -- Full MatchReport JSON; the extracted columns above are for queries.
  report     TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  synced_at  INTEGER
);
CREATE INDEX match_reports_account ON match_reports (account_id);
"#,
    r#"
-- Every hero kill from the live broadcast. Accounts are NULL for kills by
-- or on non-players (troopers, guardians) or players we couldn't map.
CREATE TABLE match_kills (
  match_id          INTEGER NOT NULL REFERENCES matches (match_id) ON DELETE CASCADE,
  tick              INTEGER NOT NULL,
  -- Victim pawn entity index: with tick, tells two kills apart.
  victim_entity     INTEGER NOT NULL,
  clock             REAL,
  victim_account    INTEGER,
  attacker_account  INTEGER,
  -- JSON array of assisting account ids.
  assister_accounts TEXT NOT NULL,
  souls             INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  synced_at         INTEGER,
  PRIMARY KEY (match_id, tick, victim_entity)
);
CREATE INDEX match_kills_attacker ON match_kills (attacker_account);
CREATE INDEX match_kills_victim ON match_kills (victim_account);
"#,
];

/// `SET` clause implementing the rank rule above for `cols` of `table`.
fn merge_clause(table: &str, cols: &[&str]) -> String {
    let mut parts: Vec<String> = cols
        .iter()
        .map(|c| {
            format!(
                "{c} = CASE WHEN excluded.source >= {table}.source \
                 THEN COALESCE(excluded.{c}, {table}.{c}) \
                 ELSE COALESCE({table}.{c}, excluded.{c}) END"
            )
        })
        .collect();
    parts.push(format!("source = max(excluded.source, {table}.source)"));
    parts.push("updated_at = unixepoch()".into());
    parts.join(", ")
}

static UPSERT_MATCH: LazyLock<String> = LazyLock::new(|| {
    let cols = [
        "start_time",
        "duration_s",
        "game_mode",
        "match_mode",
        "winning_team",
        "build",
        "map",
        "souls_history",
    ];
    format!(
        "INSERT INTO matches (match_id, source, {list}, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, unixepoch(), unixepoch()) \
         ON CONFLICT (match_id) DO UPDATE SET {set}",
        list = cols.join(", "),
        set = merge_clause("matches", &cols),
    )
});

static UPSERT_MATCH_PLAYER: LazyLock<String> = LazyLock::new(|| {
    let cols = [
        "team",
        "hero_id",
        "level",
        "net_worth",
        "kills",
        "deaths",
        "assists",
        "last_hits",
        "denies",
        "hero_damage",
        "healing",
        "objective_damage",
        "abandoned",
        "items",
    ];
    format!(
        "INSERT INTO match_players (match_id, account_id, source, {list}, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, unixepoch()) \
         ON CONFLICT (match_id, account_id) DO UPDATE SET {set}",
        list = cols.join(", "),
        set = merge_clause("match_players", &cols),
    )
});

#[derive(Debug, Default)]
struct MatchRow {
    match_id: u64,
    source: i64,
    start_time: Option<i64>,
    duration_s: Option<i64>,
    game_mode: Option<i64>,
    match_mode: Option<i64>,
    winning_team: Option<i64>,
    build: Option<i64>,
    map: Option<String>,
    souls_history: Option<String>,
}

#[derive(Debug, Default)]
struct PlayerRow {
    account_id: u32,
    source: i64,
    team: Option<i64>,
    hero_id: Option<i64>,
    level: Option<i64>,
    net_worth: Option<i64>,
    kills: Option<i64>,
    deaths: Option<i64>,
    assists: Option<i64>,
    last_hits: Option<i64>,
    denies: Option<i64>,
    hero_damage: Option<i64>,
    healing: Option<i64>,
    objective_damage: Option<i64>,
    abandoned: Option<bool>,
    items: Option<String>,
}

fn upsert_match(tx: &Transaction, m: &MatchRow) -> rusqlite::Result<()> {
    tx.prepare_cached(&UPSERT_MATCH)?.execute(params![
        m.match_id as i64,
        m.source,
        m.start_time,
        m.duration_s,
        m.game_mode,
        m.match_mode,
        m.winning_team,
        m.build,
        m.map,
        m.souls_history,
    ])?;
    Ok(())
}

fn upsert_player(
    tx: &Transaction,
    account_id: u32,
    persona_name: Option<&str>,
) -> rusqlite::Result<()> {
    tx.prepare_cached(
        "INSERT INTO players (account_id, persona_name, first_seen_at, last_seen_at, updated_at)
         VALUES (?1, ?2, unixepoch(), unixepoch(), unixepoch())
         ON CONFLICT (account_id) DO UPDATE SET
           persona_name = COALESCE(excluded.persona_name, persona_name),
           last_seen_at = unixepoch(),
           updated_at = CASE WHEN excluded.persona_name IS NOT persona_name
                          AND excluded.persona_name IS NOT NULL
                        THEN unixepoch() ELSE updated_at END",
    )?
    .execute(params![account_id, persona_name])?;
    Ok(())
}

fn upsert_match_player(tx: &Transaction, match_id: u64, p: &PlayerRow) -> rusqlite::Result<()> {
    tx.prepare_cached(&UPSERT_MATCH_PLAYER)?.execute(params![
        match_id as i64,
        p.account_id,
        p.source,
        p.team,
        p.hero_id,
        p.level,
        p.net_worth,
        p.kills,
        p.deaths,
        p.assists,
        p.last_hits,
        p.denies,
        p.hero_damage,
        p.healing,
        p.objective_damage,
        p.abandoned,
        p.items,
    ])?;
    Ok(())
}

/// One entry of `/v1/players/{account_id}/match-history`.
#[derive(Debug, Clone, Deserialize)]
pub struct HistoryEntry {
    pub match_id: u64,
    pub hero_id: i64,
    pub hero_level: i64,
    pub start_time: i64,
    pub game_mode: i64,
    pub match_mode: i64,
    pub player_team: i64,
    pub player_kills: i64,
    pub player_deaths: i64,
    pub player_assists: i64,
    pub denies: i64,
    pub net_worth: i64,
    pub last_hits: i64,
    pub match_duration_s: i64,
    /// 1 = win, 2 = loss; anything else is unscored.
    pub player_match_outcome: i64,
}

impl HistoryEntry {
    fn winning_team(&self) -> Option<i64> {
        match self.player_match_outcome {
            1 => Some(self.player_team),
            2 => Some(1 - self.player_team),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Status {
    pub path: Option<PathBuf>,
    /// Why the database file couldn't be opened; data is then kept in memory.
    pub error: Option<String>,
    pub install_id: String,
    pub contribute: bool,
    pub matches: i64,
    pub players: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlayerInfo {
    pub account_id: u32,
    pub persona_name: Option<String>,
    pub first_seen_at: Option<i64>,
    pub last_seen_at: Option<i64>,
}

/// Totals over every match stored for a player. Stat sums only cover matches
/// with a scoreboard (`with_stats`); wins and losses only decided matches.
#[derive(Debug, Clone, Default, Serialize)]
pub struct Totals {
    pub matches: i64,
    pub wins: i64,
    pub losses: i64,
    pub with_stats: i64,
    pub kills: i64,
    pub deaths: i64,
    pub assists: i64,
    pub avg_net_worth: Option<f64>,
    pub seconds_played: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct HeroTotals {
    pub hero_id: i64,
    #[serde(flatten)]
    pub totals: Totals,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlayedMatch {
    pub match_id: u64,
    pub start_time: Option<i64>,
    pub duration_s: Option<i64>,
    pub game_mode: Option<i64>,
    pub match_mode: Option<i64>,
    pub team: Option<i64>,
    /// `None` when the result isn't known.
    pub won: Option<bool>,
    pub hero_id: Option<i64>,
    /// Hero codename from your console report, for matches with no `hero_id`.
    pub report_hero: Option<String>,
    pub level: Option<i64>,
    pub net_worth: Option<i64>,
    pub kills: Option<i64>,
    pub deaths: Option<i64>,
    pub assists: Option<i64>,
    pub last_hits: Option<i64>,
    pub hero_damage: Option<i64>,
    pub abandoned: Option<bool>,
    pub has_report: bool,
    /// Best source that wrote the row: `console`, `live` or `history`.
    pub source: &'static str,
}

/// Someone who shared a match with the profile's player.
#[derive(Debug, Clone, Serialize)]
pub struct Encounter {
    pub account_id: u32,
    pub persona_name: Option<String>,
    pub matches: i64,
    pub with_wins: i64,
    pub with_losses: i64,
    pub with_matches: i64,
    pub against_wins: i64,
    pub against_losses: i64,
    pub against_matches: i64,
    pub last_played: Option<i64>,
    /// Times the profile player killed them, and they the profile player.
    pub killed: i64,
    pub killed_by: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Profile {
    pub player: PlayerInfo,
    pub totals: Totals,
    pub heroes: Vec<HeroTotals>,
    pub matches: Vec<PlayedMatch>,
    pub encounters: Vec<Encounter>,
}

pub struct Store {
    conn: Mutex<Connection>,
    path: Option<PathBuf>,
    error: Option<String>,
}

impl Store {
    /// Opens (or creates) the database at `path`. If that fails, falls back
    /// to an in-memory database so the app still works, without persistence.
    pub fn open(path: &Path) -> Self {
        let opened = (|| -> Result<Connection, String> {
            if let Some(dir) = path.parent() {
                std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
            }
            let conn = Connection::open(path).map_err(|e| e.to_string())?;
            init(&conn).map_err(|e| e.to_string())?;
            Ok(conn)
        })();
        match opened {
            Ok(conn) => Self {
                conn: Mutex::new(conn),
                path: Some(path.to_path_buf()),
                error: None,
            },
            Err(e) => {
                eprintln!(
                    "Couldn't open {}: {e}; using an in-memory database",
                    path.display()
                );
                Self {
                    error: Some(e),
                    ..Self::in_memory()
                }
            }
        }
    }

    pub fn in_memory() -> Self {
        let conn = Connection::open_in_memory().expect("in-memory SQLite");
        init(&conn).expect("migrate in-memory SQLite");
        Self {
            conn: Mutex::new(conn),
            path: None,
            error: None,
        }
    }

    fn write<T>(&self, f: impl FnOnce(&Transaction) -> rusqlite::Result<T>) -> Result<T, String> {
        let mut conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let out = f(&tx).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(out)
    }

    fn read<T>(&self, f: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> Result<T, String> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        f(&conn).map_err(|e| e.to_string())
    }

    pub fn status(&self) -> Result<Status, String> {
        self.read(|c| {
            let meta = |key: &str| {
                c.query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| {
                    r.get::<_, String>(0)
                })
            };
            Ok(Status {
                path: self.path.clone(),
                error: self.error.clone(),
                install_id: meta("install_id")?,
                contribute: meta("contribute")? == "1",
                matches: c.query_row("SELECT COUNT(*) FROM matches", [], |r| r.get(0))?,
                players: c.query_row("SELECT COUNT(*) FROM players", [], |r| r.get(0))?,
            })
        })
    }

    pub fn set_contribute(&self, on: bool) -> Result<(), String> {
        self.write(|tx| {
            tx.execute(
                "UPDATE meta SET value = ?1 WHERE key = 'contribute'",
                [if on { "1" } else { "0" }],
            )
            .map(drop)
        })
    }

    /// Stores API match history for `account_id`.
    pub fn ingest_history(&self, account_id: u32, entries: &[HistoryEntry]) -> Result<(), String> {
        self.write(|tx| {
            upsert_player(tx, account_id, None)?;
            for e in entries {
                upsert_match(
                    tx,
                    &MatchRow {
                        match_id: e.match_id,
                        source: RANK_HISTORY,
                        start_time: Some(e.start_time),
                        duration_s: Some(e.match_duration_s),
                        game_mode: Some(e.game_mode),
                        match_mode: Some(e.match_mode),
                        winning_team: e.winning_team(),
                        ..MatchRow::default()
                    },
                )?;
                upsert_match_player(
                    tx,
                    e.match_id,
                    &PlayerRow {
                        account_id,
                        source: RANK_HISTORY,
                        team: Some(e.player_team),
                        hero_id: Some(e.hero_id),
                        level: Some(e.hero_level),
                        net_worth: Some(e.net_worth),
                        kills: Some(e.player_kills),
                        deaths: Some(e.player_deaths),
                        assists: Some(e.player_assists),
                        last_hits: Some(e.last_hits),
                        denies: Some(e.denies),
                        ..PlayerRow::default()
                    },
                )?;
            }
            Ok(())
        })
    }

    /// Stores a live-broadcast snapshot. Safe to call repeatedly during a match.
    pub fn ingest_live(&self, state: &LiveState) -> Result<(), String> {
        let Some(clock) = state.clock.filter(|c| *c > 0.0) else {
            return Ok(()); // No game data yet.
        };
        let team = |t: u8| (t >= 2).then(|| i64::from(t) - 2);
        let now = unix_now();
        self.write(|tx| {
            upsert_match(
                tx,
                &MatchRow {
                    match_id: state.match_id,
                    source: RANK_LIVE,
                    start_time: Some(now - clock as i64),
                    duration_s: Some(clock as i64),
                    winning_team: state.winning_team.and_then(team),
                    souls_history: serde_json::to_string(&state.souls_history).ok(),
                    ..MatchRow::default()
                },
            )?;
            for p in &state.players {
                let Some(account_id) = p.account_id else {
                    continue;
                };
                upsert_player(
                    tx,
                    account_id,
                    (!p.name.is_empty()).then_some(p.name.as_str()),
                )?;
                upsert_match_player(
                    tx,
                    state.match_id,
                    &PlayerRow {
                        account_id,
                        source: RANK_LIVE,
                        team: team(p.team),
                        hero_id: Some(p.hero_id).filter(|h| *h > 0),
                        level: Some(p.level),
                        net_worth: Some(p.net_worth),
                        kills: Some(p.kills),
                        deaths: Some(p.deaths),
                        assists: Some(p.assists),
                        last_hits: Some(p.last_hits),
                        denies: Some(p.denies),
                        hero_damage: Some(p.hero_damage),
                        healing: Some(p.healing),
                        objective_damage: Some(p.objective_damage),
                        abandoned: Some(p.abandoned),
                        items: serde_json::to_string(&p.items).ok(),
                    },
                )?;
            }
            let account = |slot: Option<i64>| {
                let slot = slot?;
                state.players.iter().find(|p| p.slot == slot)?.account_id
            };
            let mut insert_kill = tx.prepare_cached(
                "INSERT INTO match_kills (match_id, tick, victim_entity, clock, victim_account,
                   attacker_account, assister_accounts, souls, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, unixepoch())
                 ON CONFLICT (match_id, tick, victim_entity) DO UPDATE SET
                   clock = COALESCE(excluded.clock, clock),
                   victim_account = COALESCE(excluded.victim_account, victim_account),
                   attacker_account = COALESCE(excluded.attacker_account, attacker_account),
                   assister_accounts = excluded.assister_accounts,
                   souls = excluded.souls,
                   updated_at = unixepoch()
                 WHERE excluded.clock IS NOT clock
                    OR excluded.victim_account IS NOT victim_account
                    OR excluded.attacker_account IS NOT attacker_account
                    OR excluded.assister_accounts IS NOT assister_accounts
                    OR excluded.souls IS NOT souls",
            )?;
            for k in &state.kills {
                let assisters: Vec<u32> = k
                    .assisters
                    .iter()
                    .filter_map(|s| account(Some(*s)))
                    .collect();
                insert_kill.execute(params![
                    state.match_id as i64,
                    k.tick,
                    k.victim_entity,
                    k.clock,
                    account(k.victim),
                    account(k.attacker),
                    serde_json::to_string(&assisters).unwrap_or_else(|_| "[]".into()),
                    k.souls,
                ])?;
            }
            Ok(())
        })
    }

    /// Stores your console report. With an `account_id`, the match also shows
    /// in your history even if no other source ever sees it.
    pub fn ingest_report(
        &self,
        report: &MatchReport,
        account_id: Option<u32>,
    ) -> Result<(), String> {
        if report.match_id == 0 {
            return Ok(());
        }
        let json = serde_json::to_string(report).map_err(|e| e.to_string())?;
        // The log only has wall-clock times without a date, so the first time
        // we see the match stands in for its start until a better source says.
        let start_time = (report.phase != MatchPhase::Ended).then(unix_now);
        self.write(|tx| {
            upsert_match(
                tx,
                &MatchRow {
                    match_id: report.match_id,
                    source: RANK_CONSOLE,
                    start_time,
                    duration_s: report.duration_secs.map(i64::from),
                    build: report.build.map(i64::from),
                    map: report.map.clone(),
                    ..MatchRow::default()
                },
            )?;
            if let Some(account_id) = account_id {
                upsert_player(tx, account_id, None)?;
                // No stats: the log has no scoreboard.
                upsert_match_player(
                    tx,
                    report.match_id,
                    &PlayerRow {
                        account_id,
                        source: RANK_CONSOLE,
                        ..PlayerRow::default()
                    },
                )?;
            }
            tx.prepare_cached(
                "INSERT INTO match_reports
                   (match_id, account_id, my_hero, left_early, deaths, ping_p50, fps_avg, report, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, unixepoch())
                 ON CONFLICT (match_id) DO UPDATE SET
                   account_id = COALESCE(excluded.account_id, account_id),
                   my_hero = excluded.my_hero, left_early = excluded.left_early,
                   deaths = excluded.deaths, ping_p50 = excluded.ping_p50,
                   fps_avg = excluded.fps_avg, report = excluded.report,
                   updated_at = unixepoch()
                 WHERE excluded.report IS NOT report",
            )?
            .execute(params![
                report.match_id as i64,
                account_id,
                report.my_hero,
                report.left_early,
                report.deaths.len() as i64,
                report.network.ping_p50,
                report.performance.fps_avg,
                json,
            ])?;
            Ok(())
        })
    }

    pub fn profile(&self, account_id: u32, limit: u32) -> Result<Profile, String> {
        self.read(|c| {
            let player = c
                .query_row(
                    "SELECT persona_name, first_seen_at, last_seen_at FROM players WHERE account_id = ?1",
                    [account_id],
                    |r| {
                        Ok(PlayerInfo {
                            account_id,
                            persona_name: r.get(0)?,
                            first_seen_at: r.get(1)?,
                            last_seen_at: r.get(2)?,
                        })
                    },
                )
                .optional()?
                .unwrap_or(PlayerInfo {
                    account_id,
                    persona_name: None,
                    first_seen_at: None,
                    last_seen_at: None,
                });

            const GAMES: &str = "WITH g AS (
                SELECT mp.*, m.duration_s,
                  CASE WHEN m.winning_team IS NULL OR mp.team IS NULL THEN NULL
                       ELSE m.winning_team = mp.team END AS won
                FROM match_players mp JOIN matches m USING (match_id)
                WHERE mp.account_id = ?1)";
            const TOTALS: &str = "COUNT(*), IFNULL(SUM(won = 1), 0), IFNULL(SUM(won = 0), 0),
                COUNT(kills), IFNULL(SUM(kills), 0), IFNULL(SUM(deaths), 0),
                IFNULL(SUM(assists), 0), AVG(net_worth), IFNULL(SUM(duration_s), 0)";
            let totals_at = |r: &rusqlite::Row, i: usize| -> rusqlite::Result<Totals> {
                Ok(Totals {
                    matches: r.get(i)?,
                    wins: r.get(i + 1)?,
                    losses: r.get(i + 2)?,
                    with_stats: r.get(i + 3)?,
                    kills: r.get(i + 4)?,
                    deaths: r.get(i + 5)?,
                    assists: r.get(i + 6)?,
                    avg_net_worth: r.get(i + 7)?,
                    seconds_played: r.get(i + 8)?,
                })
            };

            let totals = c.query_row(&format!("{GAMES} SELECT {TOTALS} FROM g"), [account_id], |r| {
                totals_at(r, 0)
            })?;

            let heroes = c
                .prepare(&format!(
                    "{GAMES} SELECT hero_id, {TOTALS} FROM g WHERE hero_id IS NOT NULL
                     GROUP BY hero_id ORDER BY COUNT(*) DESC, hero_id"
                ))?
                .query_map([account_id], |r| {
                    Ok(HeroTotals {
                        hero_id: r.get(0)?,
                        totals: totals_at(r, 1)?,
                    })
                })?
                .collect::<rusqlite::Result<_>>()?;

            let matches = c
                .prepare(
                    "SELECT m.match_id, m.start_time, m.duration_s, m.game_mode, m.match_mode,
                       mp.team, m.winning_team, mp.hero_id, r.my_hero, mp.level, mp.net_worth,
                       mp.kills, mp.deaths, mp.assists, mp.last_hits, mp.hero_damage, mp.abandoned,
                       r.match_id IS NOT NULL, mp.source
                     FROM match_players mp
                     JOIN matches m USING (match_id)
                     LEFT JOIN match_reports r ON r.match_id = mp.match_id AND r.account_id = mp.account_id
                     WHERE mp.account_id = ?1
                     ORDER BY COALESCE(m.start_time, m.created_at) DESC, m.match_id DESC
                     LIMIT ?2",
                )?
                .query_map(params![account_id, limit], |r| {
                    let team: Option<i64> = r.get(5)?;
                    let winner: Option<i64> = r.get(6)?;
                    Ok(PlayedMatch {
                        match_id: r.get::<_, i64>(0)? as u64,
                        start_time: r.get(1)?,
                        duration_s: r.get(2)?,
                        game_mode: r.get(3)?,
                        match_mode: r.get(4)?,
                        team,
                        won: team.zip(winner).map(|(t, w)| t == w),
                        hero_id: r.get(7)?,
                        report_hero: r.get(8)?,
                        level: r.get(9)?,
                        net_worth: r.get(10)?,
                        kills: r.get(11)?,
                        deaths: r.get(12)?,
                        assists: r.get(13)?,
                        last_hits: r.get(14)?,
                        hero_damage: r.get(15)?,
                        abandoned: r.get(16)?,
                        has_report: r.get(17)?,
                        source: match r.get::<_, i64>(18)? {
                            RANK_HISTORY => "history",
                            RANK_LIVE => "live",
                            _ => "console",
                        },
                    })
                })?
                .collect::<rusqlite::Result<_>>()?;

            let encounters = c
                .prepare(
                    "SELECT o.account_id, p.persona_name, COUNT(*),
                       IFNULL(SUM(o.team = me.team AND m.winning_team = me.team), 0),
                       IFNULL(SUM(o.team = me.team AND m.winning_team != me.team), 0),
                       IFNULL(SUM(o.team = me.team), 0),
                       IFNULL(SUM(o.team != me.team AND m.winning_team = me.team), 0),
                       IFNULL(SUM(o.team != me.team AND m.winning_team != me.team), 0),
                       IFNULL(SUM(o.team != me.team), 0),
                       MAX(COALESCE(m.start_time, m.created_at)),
                       (SELECT COUNT(*) FROM match_kills k
                        WHERE k.attacker_account = ?1 AND k.victim_account = o.account_id),
                       (SELECT COUNT(*) FROM match_kills k
                        WHERE k.attacker_account = o.account_id AND k.victim_account = ?1)
                     FROM match_players me
                     JOIN match_players o ON o.match_id = me.match_id AND o.account_id != me.account_id
                     JOIN matches m ON m.match_id = me.match_id
                     LEFT JOIN players p ON p.account_id = o.account_id
                     WHERE me.account_id = ?1
                     GROUP BY o.account_id
                     ORDER BY COUNT(*) DESC, MAX(COALESCE(m.start_time, m.created_at)) DESC
                     LIMIT ?2",
                )?
                .query_map(params![account_id, limit], |r| {
                    Ok(Encounter {
                        account_id: r.get(0)?,
                        persona_name: r.get(1)?,
                        matches: r.get(2)?,
                        with_wins: r.get(3)?,
                        with_losses: r.get(4)?,
                        with_matches: r.get(5)?,
                        against_wins: r.get(6)?,
                        against_losses: r.get(7)?,
                        against_matches: r.get(8)?,
                        last_played: r.get(9)?,
                        killed: r.get(10)?,
                        killed_by: r.get(11)?,
                    })
                })?
                .collect::<rusqlite::Result<_>>()?;

            Ok(Profile {
                player,
                totals,
                heroes,
                matches,
                encounters,
            })
        })
    }
}

fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;",
    )?;
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(version as usize) {
        conn.execute_batch(&format!(
            "BEGIN; {sql}\nPRAGMA user_version = {}; COMMIT;",
            i + 1
        ))?;
    }
    Ok(())
}

fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::live::{LiveKill, LivePlayer, LiveState, LiveStatus};
    use crate::match_report::{HitReg, Network, Performance};

    fn history(match_id: u64, team: i64, outcome: i64, kills: i64) -> HistoryEntry {
        HistoryEntry {
            match_id,
            hero_id: 7,
            hero_level: 30,
            start_time: 1_700_000_000 + match_id as i64,
            game_mode: 1,
            match_mode: 1,
            player_team: team,
            player_kills: kills,
            player_deaths: 2,
            player_assists: 3,
            denies: 1,
            net_worth: 40_000,
            last_hits: 200,
            match_duration_s: 1800,
            player_match_outcome: outcome,
        }
    }

    // Both types have private fields, so no struct-update syntax.
    fn live_player(account_id: u32, team: u8, name: &str) -> LivePlayer {
        let mut p = LivePlayer::default();
        p.account_id = Some(account_id);
        p.team = team;
        p.name = name.into();
        p.hero_id = 11;
        p.kills = 1;
        p.hero_damage = 9000;
        p.items = vec![1, 2];
        p
    }

    fn live(match_id: u64, players: Vec<LivePlayer>, winning_team: Option<u8>) -> LiveState {
        let mut s = LiveState::default();
        s.match_id = match_id;
        s.status = LiveStatus::Ended;
        s.clock = Some(1500.0);
        s.winning_team = winning_team;
        s.players = players;
        s
    }

    fn report(match_id: u64, phase: MatchPhase) -> MatchReport {
        MatchReport {
            match_id,
            lobby_id: 1,
            build: Some(10932),
            map: Some("street_test".into()),
            phase,
            players: Some(12),
            found_at: "12:00:00".into(),
            queue_secs: Some(30),
            load_secs: Some(40),
            started_at: Some("10/12 21:00:00".into()),
            duration_secs: Some(1490),
            left_early: false,
            my_hero: Some("hornet".into()),
            roster: vec![],
            deaths: vec![],
            hit_reg: HitReg::default(),
            network: Network::default(),
            performance: Performance::default(),
        }
    }

    #[test]
    fn migrations_are_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        init(&conn).unwrap();
        let v: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v as usize, MIGRATIONS.len());
    }

    #[test]
    fn history_builds_a_profile() {
        let store = Store::in_memory();
        store
            .ingest_history(
                42,
                &[
                    history(1, 0, 1, 10),
                    history(2, 1, 2, 4),
                    history(3, 0, 5, 0),
                ],
            )
            .unwrap();
        let p = store.profile(42, 50).unwrap();
        assert_eq!(p.totals.matches, 3);
        assert_eq!((p.totals.wins, p.totals.losses), (1, 1));
        assert_eq!(p.totals.kills, 14);
        assert_eq!(p.heroes.len(), 1);
        assert_eq!(p.matches[0].match_id, 3, "newest first");
        assert_eq!(p.matches[0].won, None);
        assert_eq!(p.matches[1].won, Some(false));
        assert_eq!(p.matches[2].won, Some(true));
    }

    #[test]
    fn sources_merge_by_rank_in_any_order() {
        let a = Store::in_memory();
        let b = Store::in_memory();
        let players = vec![
            live_player(42, 2, "me"),
            live_player(7, 2, "mate"),
            live_player(9, 3, "foe"),
        ];
        let state = live(1, players, Some(2));
        let hist = [history(1, 0, 1, 10)];

        a.ingest_live(&state).unwrap();
        a.ingest_history(42, &hist).unwrap();
        b.ingest_history(42, &hist).unwrap();
        b.ingest_live(&state).unwrap();

        for store in [&a, &b] {
            let m = &store.profile(42, 10).unwrap().matches[0];
            // History wins on what it knows...
            assert_eq!(
                (m.kills, m.hero_id, m.start_time),
                (Some(10), Some(7), Some(1_700_000_001))
            );
            // ...live fills in what it doesn't.
            assert_eq!(m.hero_damage, Some(9000));
            assert_eq!(m.won, Some(true));
            assert_eq!(m.source, "history");
        }
    }

    #[test]
    fn encounters_split_teammates_and_opponents() {
        let store = Store::in_memory();
        store
            .ingest_live(&live(
                1,
                vec![
                    live_player(42, 2, "me"),
                    live_player(7, 2, "mate"),
                    live_player(9, 3, "foe"),
                ],
                Some(2),
            ))
            .unwrap();
        store
            .ingest_live(&live(
                2,
                vec![live_player(42, 2, "me"), live_player(7, 3, "mate")],
                Some(3),
            ))
            .unwrap();
        let e = store.profile(42, 10).unwrap().encounters;
        assert_eq!(e.len(), 2);
        let mate = &e[0];
        assert_eq!(
            (mate.account_id, mate.persona_name.as_deref(), mate.matches),
            (7, Some("mate"), 2)
        );
        assert_eq!(
            (mate.with_matches, mate.with_wins, mate.with_losses),
            (1, 1, 0)
        );
        assert_eq!(
            (mate.against_matches, mate.against_wins, mate.against_losses),
            (1, 0, 1)
        );
        // Other players get profiles too.
        assert_eq!(store.profile(9, 10).unwrap().totals.losses, 1);
    }

    fn kill(tick: i64, victim: i64, attacker: i64, assisters: Vec<i64>) -> LiveKill {
        LiveKill {
            tick,
            clock: Some(tick as f32 / 64.0),
            victim: Some(victim),
            attacker: Some(attacker),
            assisters,
            souls: 500,
            victim_entity: victim + 100,
        }
    }

    #[test]
    fn stores_every_kill_once() {
        let store = Store::in_memory();
        let mut players = vec![
            live_player(42, 2, "me"),
            live_player(7, 2, "mate"),
            live_player(9, 3, "foe"),
        ];
        for (slot, p) in players.iter_mut().enumerate() {
            p.slot = slot as i64;
        }
        let mut state = live(1, players, None);
        state.kills = (0..40).map(|i| kill(1000 + i, 2, 0, vec![1])).collect();
        state.kills.push(kill(5000, 0, 2, vec![]));
        // Saved every 30 s, so the same kills arrive again.
        store.ingest_live(&state).unwrap();
        store.ingest_live(&state).unwrap();

        let (count, assisters): (i64, String) = store
            .read(|c| {
                c.query_row(
                    "SELECT COUNT(*), (SELECT assister_accounts FROM match_kills WHERE tick = 1000)
                     FROM match_kills WHERE match_id = 1",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
            })
            .unwrap();
        assert_eq!(count, 41, "all kills, not just the last 30");
        assert_eq!(assisters, "[7]");

        let foe = store
            .profile(42, 10)
            .unwrap()
            .encounters
            .into_iter()
            .find(|e| e.account_id == 9)
            .unwrap();
        assert_eq!((foe.killed, foe.killed_by), (40, 1));
    }

    #[test]
    fn console_report_alone_records_the_match() {
        let store = Store::in_memory();
        store
            .ingest_report(&report(5, MatchPhase::InProgress), Some(42))
            .unwrap();
        store
            .ingest_report(&report(5, MatchPhase::Ended), Some(42))
            .unwrap();
        let p = store.profile(42, 10).unwrap();
        assert_eq!(p.matches.len(), 1);
        let m = &p.matches[0];
        assert!(m.has_report);
        assert_eq!(m.report_hero.as_deref(), Some("hornet"));
        assert_eq!(
            (m.source, m.won, m.duration_s),
            ("console", None, Some(1490))
        );
        assert!(m.start_time.is_some());

        // A better source later replaces the console guesses.
        store.ingest_history(42, &[history(5, 1, 1, 3)]).unwrap();
        let m = &store.profile(42, 10).unwrap().matches[0];
        assert_eq!(
            (m.source, m.won, m.duration_s),
            ("history", Some(true), Some(1800))
        );
        assert!(m.has_report);
    }

    #[test]
    fn re_ingesting_an_unchanged_report_leaves_it_synced() {
        let store = Store::in_memory();
        store
            .ingest_report(&report(5, MatchPhase::Ended), None)
            .unwrap();
        store
            .write(|tx| tx.execute("UPDATE match_reports SET synced_at = updated_at", []))
            .unwrap();
        store
            .ingest_report(&report(5, MatchPhase::Ended), None)
            .unwrap();
        let pending: i64 = store
            .read(|c| {
                c.query_row(
                    "SELECT COUNT(*) FROM match_reports WHERE synced_at IS NULL OR synced_at < updated_at",
                    [],
                    |r| r.get(0),
                )
            })
            .unwrap();
        assert_eq!(pending, 0);
    }

    #[test]
    fn contribute_defaults_on_and_toggles() {
        let store = Store::in_memory();
        let s = store.status().unwrap();
        assert!(s.contribute);
        assert_eq!(s.install_id.len(), 32);
        store.set_contribute(false).unwrap();
        assert!(!store.status().unwrap().contribute);
    }
}
