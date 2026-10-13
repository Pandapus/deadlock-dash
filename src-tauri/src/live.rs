//! Live scoreboard for any match, from the SourceTV broadcast that
//! deadlock-api.com parses server-side and streams as SQL rows over SSE
//! (`/v1/matches/demo/live/query`).
//!
//! The broadcast carries Valve's spectator delay, and everything here is also
//! visible on the in-game scoreboard. Hero positions, cooldowns and other
//! hidden information are deliberately not queried.
//!
//! Rate limits: resolving a match to its broadcast URL spectates the lobby
//! and is limited to 6/hour per IP, so the URL is looked up in the free
//! `/v1/matches/live/urls` list first and cached. Queries that pass the
//! broadcast URL directly are limited to 20/minute.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use reqwest::Client;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::api::{api_key, BASE_URL, USER_AGENT};
use crate::db::{self, Store};

pub const EVENT_LIVE: &str = "live://state";

const TICK_RATE: f32 = 64.0;
const EMIT_INTERVAL: Duration = Duration::from_secs(1);
const SAVE_INTERVAL: Duration = Duration::from_secs(30);
const RETRY_DELAY: Duration = Duration::from_secs(5);
const MAX_RETRIES: u32 = 12;
const KILLFEED_LEN: usize = 30;
/// Seconds of match time between soul-history samples.
const SOULS_SAMPLE_SECS: f32 = 10.0;
/// SteamID64 of account id 0.
const STEAM64_BASE: u64 = 76_561_197_960_265_728;

const CONTROLLER_QUERY: &str = r#"SELECT tick, entity_index,
  "m_iszPlayerName" AS name, "m_steamID" AS steam_id, "m_iTeamNum" AS team, "m_hHeroPawn" AS pawn,
  "m_PlayerDataGlobal__m_nHeroID" AS hero_id, "m_PlayerDataGlobal__m_iLevel" AS level,
  "m_PlayerDataGlobal__m_iGoldNetWorth" AS net_worth,
  "m_PlayerDataGlobal__m_iPlayerKills" AS kills, "m_PlayerDataGlobal__m_iDeaths" AS deaths,
  "m_PlayerDataGlobal__m_iPlayerAssists" AS assists, "m_PlayerDataGlobal__m_iLastHits" AS last_hits,
  "m_PlayerDataGlobal__m_iDenies" AS denies, "m_PlayerDataGlobal__m_iHeroDamage" AS hero_damage,
  "m_PlayerDataGlobal__m_iHeroHealing" AS healing, "m_PlayerDataGlobal__m_iObjectiveDamage" AS objective_damage,
  "m_PlayerDataGlobal__m_bAlive" AS alive, "m_PlayerDataGlobal__m_iKillStreak" AS kill_streak,
  "m_PlayerDataGlobal__m_bAbandon" AS abandoned, "m_PlayerDataGlobal__m_vecUpgrades" AS upgrades
FROM CCitadelPlayerController"#;

const RULES_QUERY: &str = r#"SELECT tick,
  "m_pGameRules__m_nMatchClockUpdateTick" AS clock_tick,
  "m_pGameRules__m_flMatchClockAtLastUpdate" AS clock_at,
  "m_pGameRules__m_bGamePaused" AS paused,
  "m_pGameRules__m_iWinningTeam" AS winning_team,
  "m_pGameRules__m_tStreetBrawl__m_iRound" AS round,
  "m_pGameRules__m_tStreetBrawl__m_iTeamAmberScore" AS amber_score,
  "m_pGameRules__m_tStreetBrawl__m_iTeamSapphireScore" AS sapphire_score
FROM CCitadelGameRulesProxy"#;

const KILLS_QUERY: &str = r#"SELECT tick, entindex_victim AS victim, entindex_attacker AS attacker,
  entindex_assisters AS assisters, killfeed_gold AS souls FROM HeroKilledEvent"#;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum LiveStatus {
    #[default]
    Resolving,
    /// Connected; the broadcast relay is still spinning up.
    Waiting,
    Live,
    Ended,
    Error,
}

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
pub struct LivePlayer {
    /// Controller entity index; stable for the match.
    pub slot: i64,
    pub name: String,
    pub account_id: Option<u32>,
    /// 2 = Amber (Hidden King), 3 = Sapphire (Archmother).
    pub team: u8,
    pub hero_id: i64,
    pub level: i64,
    pub net_worth: i64,
    pub kills: i64,
    pub deaths: i64,
    pub assists: i64,
    pub last_hits: i64,
    pub denies: i64,
    pub hero_damage: i64,
    pub healing: i64,
    pub objective_damage: i64,
    pub alive: bool,
    pub kill_streak: i64,
    pub abandoned: bool,
    /// Item ids, in purchase order.
    pub items: Vec<u32>,
    #[serde(skip)]
    pawn: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LiveKill {
    pub clock: Option<f32>,
    /// Player slots; `None` for non-player killers (troopers, guardians).
    pub victim: Option<i64>,
    pub attacker: Option<i64>,
    pub assisters: Vec<i64>,
    pub souls: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SoulsSample {
    pub clock: f32,
    pub amber: i64,
    pub sapphire: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
pub struct LiveState {
    pub match_id: u64,
    pub status: LiveStatus,
    pub message: Option<String>,
    pub tick: i64,
    /// Match clock in seconds (negative during the pre-game countdown).
    pub clock: Option<f32>,
    pub paused: bool,
    pub round: i64,
    pub amber_score: i64,
    pub sapphire_score: i64,
    pub winning_team: Option<u8>,
    pub players: Vec<LivePlayer>,
    pub kills: Vec<LiveKill>,
    pub souls_history: Vec<SoulsSample>,
    #[serde(skip)]
    clock_ref: Option<(i64, f32)>,
}

fn int(row: &Value, key: &str) -> i64 {
    row.get(key).and_then(Value::as_i64).unwrap_or(0)
}

/// Binary columns arrive as hex; ids are little-endian u32s.
fn hex_u32(hex: &str) -> Option<u32> {
    let bytes = (0..4)
        .map(|i| u8::from_str_radix(hex.get(i * 2..i * 2 + 2)?, 16).ok())
        .collect::<Option<Vec<u8>>>()?;
    Some(u32::from_le_bytes(bytes.try_into().ok()?))
}

/// Deadlock entity handles keep the entity index in the low 14 bits; the
/// rest is a serial number that changes when a hero respawns.
fn handle_index(handle: i64) -> i64 {
    handle & 0x3FFF
}

impl LiveState {
    fn new(match_id: u64) -> Self {
        Self {
            match_id,
            ..Self::default()
        }
    }

    /// Rows from the separate streams interleave, so time only moves forward.
    fn advance(&mut self, tick: i64) {
        self.tick = self.tick.max(tick);
        if let Some((ref_tick, ref_clock)) = self.clock_ref {
            if !self.paused {
                self.clock = Some(ref_clock + (self.tick - ref_tick) as f32 / TICK_RATE);
            }
        }
        self.sample_souls();
    }

    fn sample_souls(&mut self) {
        let Some(clock) = self.clock.filter(|c| *c >= 0.0) else {
            return;
        };
        if self
            .souls_history
            .last()
            .is_some_and(|s| clock - s.clock < SOULS_SAMPLE_SECS)
        {
            return;
        }
        let sum = |team| {
            self.players
                .iter()
                .filter(|p| p.team == team)
                .map(|p| p.net_worth)
                .sum()
        };
        let (amber, sapphire) = (sum(2), sum(3));
        // Wait for both rosters so the first sample isn't one-sided.
        if amber > 0 && sapphire > 0 {
            self.souls_history.push(SoulsSample {
                clock,
                amber,
                sapphire,
            });
        }
    }

    pub fn apply_controller(&mut self, row: &Value) {
        let steam_id = row.get("steam_id").and_then(Value::as_u64).unwrap_or(0);
        if steam_id == 0 {
            return; // SourceTV
        }
        let slot = int(row, "entity_index");
        let player = match self.players.iter_mut().position(|p| p.slot == slot) {
            Some(i) => &mut self.players[i],
            None => {
                self.players.push(LivePlayer {
                    slot,
                    ..LivePlayer::default()
                });
                self.players.last_mut().unwrap()
            }
        };
        player.name = row["name"].as_str().unwrap_or_default().to_owned();
        player.account_id = steam_id
            .checked_sub(STEAM64_BASE)
            .and_then(|id| u32::try_from(id).ok());
        player.team = int(row, "team") as u8;
        player.pawn = handle_index(int(row, "pawn"));
        player.hero_id = int(row, "hero_id");
        player.level = int(row, "level");
        player.net_worth = int(row, "net_worth");
        player.kills = int(row, "kills");
        player.deaths = int(row, "deaths");
        player.assists = int(row, "assists");
        player.last_hits = int(row, "last_hits");
        player.denies = int(row, "denies");
        player.hero_damage = int(row, "hero_damage");
        player.healing = int(row, "healing");
        player.objective_damage = int(row, "objective_damage");
        player.alive = row["alive"].as_bool().unwrap_or(true);
        player.kill_streak = int(row, "kill_streak");
        player.abandoned = row["abandoned"].as_bool().unwrap_or(false);
        player.items = row["upgrades"]
            .as_array()
            .map(|a| a.iter().filter_map(|v| hex_u32(v.as_str()?)).collect())
            .unwrap_or_default();
        self.players.sort_by_key(|p| p.slot);
        self.advance(int(row, "tick"));
    }

    pub fn apply_rules(&mut self, row: &Value) {
        if let (Some(t), Some(c)) = (
            row.get("clock_tick").and_then(Value::as_i64),
            row.get("clock_at").and_then(Value::as_f64),
        ) {
            self.clock_ref = Some((t, c as f32));
        }
        self.paused = row["paused"].as_bool().unwrap_or(false);
        self.round = int(row, "round");
        self.amber_score = int(row, "amber_score");
        self.sapphire_score = int(row, "sapphire_score");
        self.winning_team = u8::try_from(int(row, "winning_team"))
            .ok()
            .filter(|t| *t >= 2);
        self.advance(int(row, "tick"));
    }

    pub fn apply_kill(&mut self, row: &Value) {
        let by_pawn = |index: i64| self.players.iter().find(|p| p.pawn == index).map(|p| p.slot);
        let kill = LiveKill {
            clock: self.clock,
            victim: by_pawn(int(row, "victim")),
            attacker: by_pawn(int(row, "attacker")),
            assisters: row["assisters"]
                .as_array()
                .map(|a| a.iter().filter_map(|v| by_pawn(v.as_i64()?)).collect())
                .unwrap_or_default(),
            souls: int(row, "souls"),
        };
        self.kills.push(kill);
        if self.kills.len() > KILLFEED_LEN {
            self.kills.remove(0);
        }
    }
}

/// Owns the running feed; at most one at a time.
pub struct LiveFeed {
    client: Client,
    stop: Mutex<Option<Arc<AtomicBool>>>,
    urls: Arc<Mutex<HashMap<u64, String>>>,
}

impl LiveFeed {
    pub fn new() -> Self {
        let client = Client::builder()
            .user_agent(USER_AGENT)
            .connect_timeout(Duration::from_secs(15))
            .build()
            .expect("failed to build HTTP client");
        Self {
            client,
            stop: Mutex::new(None),
            urls: Arc::default(),
        }
    }

    pub fn start(&self, app: AppHandle, match_id: u64) {
        let stop = Arc::new(AtomicBool::new(false));
        if let Some(previous) = self.stop.lock().unwrap().replace(stop.clone()) {
            previous.store(true, Ordering::Relaxed);
        }
        let client = self.client.clone();
        let urls = self.urls.clone();
        tauri::async_runtime::spawn(async move {
            run(app, client, urls, match_id, stop).await;
        });
    }

    pub fn stop(&self) {
        if let Some(stop) = self.stop.lock().unwrap().take() {
            stop.store(true, Ordering::Relaxed);
        }
    }
}

type Shared = Arc<Mutex<(LiveState, bool)>>;

fn update(shared: &Shared, f: impl FnOnce(&mut LiveState)) {
    let mut guard = shared.lock().unwrap();
    f(&mut guard.0);
    guard.1 = true;
}

async fn run(
    app: AppHandle,
    client: Client,
    urls: Arc<Mutex<HashMap<u64, String>>>,
    match_id: u64,
    stop: Arc<AtomicBool>,
) {
    let shared: Shared = Arc::new(Mutex::new((LiveState::new(match_id), true)));

    // Emitter: at most once per second, and once more when stopping. Also
    // saves to the database now and then, so a crash loses little.
    let emitter = {
        let (app, shared, stop) = (app.clone(), shared.clone(), stop.clone());
        tauri::async_runtime::spawn(async move {
            let mut unsaved: Option<LiveState> = None;
            let mut last_save = Instant::now();
            loop {
                let done = stop.load(Ordering::Relaxed);
                let snapshot = {
                    let mut guard = shared.lock().unwrap();
                    std::mem::take(&mut guard.1).then(|| guard.0.clone())
                };
                if let Some(state) = snapshot {
                    let _ = app.emit(EVENT_LIVE, &state);
                    unsaved = Some(state);
                }
                if done || last_save.elapsed() >= SAVE_INTERVAL {
                    if let Some(state) = unsaved.take() {
                        save(&app, &state, done);
                    }
                    last_save = Instant::now();
                }
                if done {
                    break;
                }
                tokio::time::sleep(EMIT_INTERVAL).await;
            }
        })
    };

    let cached = urls.lock().unwrap().get(&match_id).cloned();
    let url = match cached {
        Some(url) => Ok(url),
        None => resolve_broadcast_url(&client, match_id).await,
    };
    match url {
        Ok(url) => {
            urls.lock().unwrap().insert(match_id, url.clone());
            let streams = [
                (CONTROLLER_QUERY, LiveState::apply_controller as fn(&mut LiveState, &Value)),
                (RULES_QUERY, LiveState::apply_rules),
                (KILLS_QUERY, LiveState::apply_kill),
            ]
            .map(|(query, apply)| {
                let (client, url, shared, stop) =
                    (client.clone(), url.clone(), shared.clone(), stop.clone());
                tauri::async_runtime::spawn(async move {
                    stream_with_retries(&client, &url, query, &shared, &stop, apply).await;
                })
            });
            for handle in streams {
                let _ = handle.await;
            }
            update(&shared, |s| {
                if matches!(s.status, LiveStatus::Resolving | LiveStatus::Waiting | LiveStatus::Live) {
                    s.status = LiveStatus::Ended;
                    s.message = Some("Stopped".into());
                }
            });
        }
        Err(e) => update(&shared, |s| {
            s.status = LiveStatus::Error;
            s.message = Some(e);
        }),
    }
    stop.store(true, Ordering::Relaxed);
    let _ = emitter.await;
}

fn save(app: &AppHandle, state: &LiveState, last: bool) {
    match app.state::<Store>().ingest_live(state) {
        Ok(()) if last => {
            let _ = app.emit(db::EVENT_CHANGED, ());
        }
        Ok(()) => {}
        Err(e) => eprintln!("Couldn't save live state for match {}: {e}", state.match_id),
    }
}

async fn resolve_broadcast_url(client: &Client, match_id: u64) -> Result<String, String> {
    // Free list of broadcasts the API already knows about.
    if let Ok(list) = get_json(client, "/v1/matches/live/urls").await {
        let found = list.as_array().and_then(|a| {
            a.iter()
                .find(|m| m["match_id"].as_u64() == Some(match_id))
                .and_then(|m| m["broadcast_url"].as_str())
        });
        if let Some(url) = found {
            return Ok(url.to_owned());
        }
    }
    // Spectates the lobby: rate-limited to 6/hour per IP without a key.
    let res = get_json(client, &format!("/v1/matches/{match_id}/live/url")).await?;
    res["broadcast_url"]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| "no broadcast URL in response".to_owned())
}

async fn get_json(client: &Client, path: &str) -> Result<Value, String> {
    let mut req = client
        .get(format!("{BASE_URL}{path}"))
        .timeout(Duration::from_secs(20));
    if let Some(key) = api_key() {
        req = req.header("X-API-KEY", key);
    }
    let res = req.send().await.map_err(|e| e.to_string())?;
    let status = res.status();
    if status.as_u16() == 429 {
        return Err("Rate limited by deadlock-api (6 live lookups per hour without an API key). Try again later.".into());
    }
    if !status.is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(format!("{status}: {}", body.chars().take(200).collect::<String>()));
    }
    res.json().await.map_err(|e| e.to_string())
}

enum StreamEnd {
    /// The broadcast finished (match over).
    Finished,
    Stopped,
}

async fn stream_with_retries(
    client: &Client,
    url: &str,
    query: &str,
    shared: &Shared,
    stop: &AtomicBool,
    apply: fn(&mut LiveState, &Value),
) {
    let mut failures = 0;
    loop {
        match stream_once(client, url, query, shared, stop, apply).await {
            Ok(StreamEnd::Finished) => {
                update(shared, |s| {
                    s.status = LiveStatus::Ended;
                    s.message = None;
                });
                stop.store(true, Ordering::Relaxed);
                return;
            }
            Ok(StreamEnd::Stopped) => return,
            Err(e) => {
                failures += 1;
                if failures > MAX_RETRIES {
                    update(shared, |s| {
                        s.status = LiveStatus::Error;
                        s.message = Some(e);
                    });
                    return;
                }
                update(shared, |s| s.message = Some(format!("Reconnecting: {e}")));
            }
        }
        tokio::time::sleep(RETRY_DELAY).await;
        if stop.load(Ordering::Relaxed) {
            return;
        }
    }
}

async fn stream_once(
    client: &Client,
    url: &str,
    query: &str,
    shared: &Shared,
    stop: &AtomicBool,
    apply: fn(&mut LiveState, &Value),
) -> Result<StreamEnd, String> {
    let mut req = client
        .get(format!("{BASE_URL}/v1/matches/demo/live/query"))
        .query(&[("broadcast_url", url), ("query", query)]);
    if let Some(key) = api_key() {
        req = req.header("X-API-KEY", key);
    }
    let mut res = req.send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("{status}: {}", body.chars().take(200).collect::<String>()));
    }

    let mut parser = SseParser::default();
    loop {
        if stop.load(Ordering::Relaxed) {
            return Ok(StreamEnd::Stopped);
        }
        // Wake up regularly so a stop request isn't stuck behind a quiet stream.
        let chunk = match tokio::time::timeout(Duration::from_secs(2), res.chunk()).await {
            Err(_) => continue,
            Ok(chunk) => chunk.map_err(|e| e.to_string())?,
        };
        let Some(chunk) = chunk else {
            return Err("stream closed".into());
        };
        let events = parser.push(&chunk);
        if events.is_empty() {
            continue;
        }
        let mut guard = shared.lock().unwrap();
        let state = &mut guard.0;
        for (event, data) in events {
            match event.as_str() {
                "message" => {
                    if let Ok(row) = serde_json::from_str::<Value>(&data) {
                        apply(state, &row);
                        if state.status != LiveStatus::Live {
                            state.status = LiveStatus::Live;
                            state.message = None;
                        }
                    }
                }
                "status" => {
                    if state.status != LiveStatus::Live {
                        state.status = LiveStatus::Waiting;
                    }
                }
                "end" => return Ok(StreamEnd::Finished),
                "error" => {
                    let msg = serde_json::from_str::<Value>(&data)
                        .ok()
                        .and_then(|v| v["error"].as_str().map(str::to_owned))
                        .unwrap_or(data);
                    return Err(msg);
                }
                _ => {}
            }
        }
        guard.1 = true;
    }
}

/// Minimal Server-Sent Events parser: yields `(event, data)` pairs.
#[derive(Default)]
struct SseParser {
    buf: String,
}

impl SseParser {
    fn push(&mut self, bytes: &[u8]) -> Vec<(String, String)> {
        self.buf.push_str(&String::from_utf8_lossy(bytes));
        if self.buf.contains('\r') {
            self.buf = self.buf.replace("\r\n", "\n");
        }
        let mut out = Vec::new();
        while let Some(end) = self.buf.find("\n\n") {
            let block: String = self.buf.drain(..end + 2).collect();
            let mut event = "message".to_owned();
            let mut data = Vec::new();
            for line in block.lines() {
                if let Some(v) = line.strip_prefix("event:") {
                    event = v.trim().to_owned();
                } else if let Some(v) = line.strip_prefix("data:") {
                    data.push(v.strip_prefix(' ').unwrap_or(v));
                }
            }
            if !data.is_empty() {
                out.push((event, data.join("\n")));
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    /// Streams a real broadcast for 40 s:
    /// `DEADLOCK_BROADCAST_URL=<url from /v1/matches/live/urls> cargo test live_broadcast -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_broadcast() {
        let url = std::env::var("DEADLOCK_BROADCAST_URL").expect("DEADLOCK_BROADCAST_URL");
        let client = Client::builder().user_agent(USER_AGENT).build().unwrap();
        let shared: Shared = Arc::new(Mutex::new((LiveState::new(0), false)));
        let stop = Arc::new(AtomicBool::new(false));
        tauri::async_runtime::block_on(async {
            let streams = [
                (CONTROLLER_QUERY, LiveState::apply_controller as fn(&mut LiveState, &Value)),
                (RULES_QUERY, LiveState::apply_rules),
                (KILLS_QUERY, LiveState::apply_kill),
            ]
            .map(|(query, apply)| {
                let (client, url, shared, stop) =
                    (client.clone(), url.clone(), shared.clone(), stop.clone());
                tauri::async_runtime::spawn(async move {
                    stream_with_retries(&client, &url, query, &shared, &stop, apply).await;
                })
            });
            tokio::time::sleep(Duration::from_secs(40)).await;
            stop.store(true, Ordering::Relaxed);
            for s in streams {
                let _ = s.await;
            }
        });
        let state = &shared.lock().unwrap().0;
        println!("{}", serde_json::to_string_pretty(state).unwrap());
        assert!(!state.players.is_empty(), "no players streamed");
    }

    #[test]
    fn handle_index_ignores_serial_bits() {
        assert_eq!(handle_index(3_866_706), 82);
        // Real handle of a hero pawn after a respawn.
        assert_eq!(handle_index(16_463), 79);
    }

    #[test]
    fn decodes_item_ids() {
        assert_eq!(hex_u32("e0ab3ee600000000"), Some(3_862_866_912));
        assert_eq!(hex_u32("f5c61c7700000000"), Some(1_998_374_645));
        assert_eq!(hex_u32("zz"), None);
    }

    #[test]
    fn parses_sse_across_chunks() {
        let mut p = SseParser::default();
        assert!(p.push(b": ping\n\nevent: status\ndata: {\"message\":\"x\"}\n\ndata: {\"ti").len() == 1);
        let events = p.push(b"ck\":1}\n\nevent: end\ndata: {}\n\n");
        assert_eq!(
            events,
            [
                ("message".to_owned(), "{\"tick\":1}".to_owned()),
                ("end".to_owned(), "{}".to_owned())
            ]
        );
    }

    #[test]
    fn builds_scoreboard_and_killfeed() {
        let mut s = LiveState::new(1);
        // Real rows from a live broadcast.
        s.apply_rules(&json!({"tick":6073,"clock_tick":6074,"clock_at":-30.0,"paused":false,
            "winning_team":-1,"round":0,"amber_score":0,"sapphire_score":0}));
        s.apply_controller(&json!({"tick":41175,"entity_index":1,"name":"mako",
            "steam_id":76561199501666262u64,"team":2,"pawn":3866706,"hero_id":6,"level":12,
            "net_worth":21000,"kills":3,"deaths":1,"assists":4,"alive":true,
            "upgrades":["e0ab3ee600000000","f5c61c7700000000"]}));
        s.apply_controller(&json!({"tick":41175,"entity_index":3,"name":"SQNHEAD",
            "steam_id":76561198064040063u64,"team":3,"pawn":15564877,"hero_id":1,"net_worth":18000}));
        s.apply_controller(&json!({"tick":41175,"entity_index":13,"name":"SourceTV","steam_id":0}));
        s.apply_kill(&json!({"tick":41176,"victim":77,"attacker":82,"assisters":[91],"souls":680}));

        assert_eq!(s.players.len(), 2);
        let mako = &s.players[0];
        assert_eq!(mako.account_id, Some(1_541_400_534));
        assert_eq!(mako.items, [3_862_866_912, 1_998_374_645]);
        assert_eq!(mako.pawn, 82);
        assert_eq!(s.clock, Some(-30.0 + (41175 - 6074) as f32 / 64.0));
        assert_eq!(s.souls_history.len(), 1);
        assert_eq!((s.souls_history[0].amber, s.souls_history[0].sapphire), (21000, 18000));
        let kill = &s.kills[0];
        assert_eq!(kill.attacker, Some(1));
        assert_eq!(kill.victim, Some(3));
        assert!(kill.assisters.is_empty());
        assert_eq!(kill.souls, 680);
    }
}
