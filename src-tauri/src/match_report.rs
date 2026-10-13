//! Builds a per-match report out of `console.log` lines.
//!
//! The log has no scoreboard, so most of this is inferred from engine
//! side-effects. Patterns were taken from a real Street Brawl match log
//! (build 10932). How each field is derived:
//!
//! - **Match / lobby id**: `Lobby <id> for Match <id> created`.
//! - **Queue time**: last `k_EMsgClientToGCPartySetReadyState` before the
//!   match was created.
//! - **Phases**: client-side `OnGameStateChanged: <Phase> (<n>)`. The
//!   server-side `ChangeGameState` lines are the local hideout and ignored.
//! - **Your hero**: the hero model whose camera poses load while you are
//!   alive (`VMDL Camera Pose Success! "models/heroes_*/<hero>/..."`).
//! - **Deaths**: the client stops predicting your pawn while you are dead
//!   (`Shutdown prediction for player slot N` ... `Added prediction`). A hero
//!   model whose camera poses load while dead is the hero you spectated,
//!   usually your killer.
//! - **Roster**: hero models loaded between match creation and the intro.
//!   Approximate: UI assets (e.g. McGinnis turrets) can add extras.
//! - **Hit registration**: `Bullet Hit Mismatch: client hit X, server hit Y`.
//!   Client hit a target but server hit world = a hit you saw that didn't count.

use std::sync::LazyLock;

use regex::Regex;
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MatchPhase {
    Loading,
    Intro,
    InProgress,
    PostGame,
    Ended,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Death {
    /// Wall-clock time from the log (`HH:MM:SS`).
    pub at: String,
    /// Seconds since the match started.
    pub match_time: u32,
    /// Seconds until you were back in control, if you respawned.
    pub respawn_secs: Option<u32>,
    /// Codename of the hero you spectated while dead (likely your killer).
    pub spectated: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct HitCounts {
    pub hero: u32,
    pub trooper: u32,
    pub objective: u32,
    pub other: u32,
}

impl HitCounts {
    fn add(&mut self, target: &str) {
        match target {
            "player" => self.hero += 1,
            t if t.starts_with("npc_trooper") => self.trooper += 1,
            t if t.starts_with("npc_boss") || t.contains("barrack") || t.contains("titan") => {
                self.objective += 1
            }
            _ => self.other += 1,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct HitReg {
    /// Your client showed a hit, the server said you hit the world.
    pub lost: HitCounts,
    /// Your client showed a miss, the server gave you the hit.
    pub gained: HitCounts,
    /// Both sides hit something, but not the same thing.
    pub swapped: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Network {
    /// Relay code of the primary Steam Datagram Relay, e.g. `dfra`.
    pub relay: Option<String>,
    pub relay_ping: Option<u32>,
    pub ping_p50: Option<u32>,
    pub ping_p95: Option<u32>,
    pub jitter_p99: Option<u32>,
    /// Share of server ticks that arrived on time (0–100).
    pub ticks_on_time_pct: Option<f32>,
    pub quality_pct: Option<f32>,
    pub dropped_pct: Option<f32>,
    /// Times the client clock was forcibly re-synced to the server.
    pub tick_resyncs: u32,
    /// Your measured ping to nearby relays, closest first: (code, ms).
    pub nearest_relays: Vec<(String, u32)>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Performance {
    pub fps_avg: Option<f32>,
    pub fps_p1: Option<f32>,
    /// Frames with more shadowed lights than the shadow cache holds.
    pub shadow_overflows: u32,
    /// Frames that exceeded the visible env-map / light-probe limit.
    pub scene_limit_hits: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MatchReport {
    pub match_id: u64,
    pub lobby_id: u64,
    pub build: Option<u32>,
    pub map: Option<String>,
    pub phase: MatchPhase,
    pub players: Option<u32>,
    pub found_at: String,
    pub queue_secs: Option<u32>,
    /// Match found → game in progress.
    pub load_secs: Option<u32>,
    /// Game in progress → post-game (or now / disconnect).
    pub duration_secs: Option<u32>,
    /// You disconnected before the post-game screen.
    pub left_early: bool,
    pub my_hero: Option<String>,
    pub roster: Vec<String>,
    pub deaths: Vec<Death>,
    pub hit_reg: HitReg,
    pub network: Network,
    pub performance: Performance,
}

/// `MM/DD HH:MM:SS` → seconds on a monotonic-enough scale (31-day months).
fn parse_time(line: &str) -> Option<(u64, &str)> {
    let b = line.as_bytes();
    if b.len() < 15 || b[2] != b'/' || b[5] != b' ' || b[8] != b':' || b[11] != b':' {
        return None;
    }
    let n = |r: std::ops::Range<usize>| line.get(r)?.parse::<u64>().ok();
    let secs = (((n(0..2)? * 31 + n(3..5)?) * 24 + n(6..8)?) * 60 + n(9..11)?) * 60 + n(12..14)?;
    Some((secs, &line[6..14]))
}

/// `models/heroes_wip/hornet_v3/...` → `hornet`; folder names that differ from
/// the API's `hero_<codename>` class names are mapped.
fn hero_codename(folder: &str) -> String {
    let base = folder.split('_').next().unwrap_or(folder);
    match base {
        "mcginnis" => "forge",
        "digger" => "krill",
        "abrams" => "atlas",
        other => other,
    }
    .to_owned()
}

static PHASE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^OnGameStateChanged: (\w+) \(").unwrap());
static HERO_MODEL_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"models/heroes_(?:wip|staging)/([a-z0-9_]+)/").unwrap());

/// Feeds on lines and keeps the report of the current (or last) match.
#[derive(Debug, Default)]
pub struct MatchTracker {
    now: u64,
    now_label: String,
    ready_at: Option<u64>,
    found_at: Option<u64>,
    started_at: Option<u64>,
    ended_at: Option<u64>,
    dead_since: Option<u64>,
    /// Another hero's camera poses loaded while alive: (time, codename).
    pending_spectate: Option<(u64, String)>,
    in_downstream: bool,
    nearest_relays: Vec<(String, u32)>,
    report: Option<MatchReport>,
    /// Reports replaced by a newer match since the last `take_finished`.
    finished: Vec<MatchReport>,
    dirty: bool,
}

impl MatchTracker {
    pub fn report(&self) -> Option<&MatchReport> {
        self.report.as_ref()
    }

    /// True once after any change to the report.
    pub fn take_dirty(&mut self) -> bool {
        std::mem::take(&mut self.dirty)
    }

    /// Earlier matches that a newer one replaced, e.g. while reading a
    /// backlog that covers several matches in one go.
    pub fn take_finished(&mut self) -> Vec<MatchReport> {
        std::mem::take(&mut self.finished)
    }

    fn active(&self) -> bool {
        self.report
            .as_ref()
            .is_some_and(|r| r.phase != MatchPhase::Ended)
    }

    fn since_start(&self) -> u32 {
        self.started_at.map_or(0, |s| self.now.saturating_sub(s) as u32)
    }

    pub fn feed(&mut self, line: &str) {
        static FOUND_RE: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"^Lobby (\d+) for Match (\d+) created").unwrap());
        static PING_LOC_RE: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"([a-z]+[0-9]?)=(\d+)\+\d+").unwrap());

        // Camera-pose lines can be glued to the previous line without a
        // timestamp, so keep the last one seen.
        let body = match parse_time(line) {
            Some((t, label)) => {
                self.now = t;
                self.now_label = label.to_owned();
                line[15..].trim_start()
            }
            None => line.trim_start(),
        };

        // Global signals (also outside a match).
        if body.contains("k_EMsgClientToGCPartySetReadyState") && body.starts_with("[GCClient] Send") {
            self.ready_at = Some(self.now);
            return;
        }
        if let Some(rest) = body.strip_prefix("[SteamNetSockets] Ping location: ") {
            let mut relays: Vec<(String, u32)> = PING_LOC_RE
                .captures_iter(rest)
                .filter_map(|c| Some((c[1].to_owned(), c[2].parse().ok()?)))
                .collect();
            relays.sort_by_key(|r| r.1);
            relays.truncate(5);
            self.nearest_relays = relays;
            return;
        }
        if let Some(c) = FOUND_RE.captures(body) {
            let (lobby_id, match_id) = (c[1].parse().unwrap_or(0), c[2].parse().unwrap_or(0));
            self.finished.extend(self.report.take());
            self.found_at = Some(self.now);
            self.started_at = None;
            self.ended_at = None;
            self.dead_since = None;
            self.pending_spectate = None;
            self.report = Some(MatchReport {
                match_id,
                lobby_id,
                build: None,
                map: None,
                phase: MatchPhase::Loading,
                players: None,
                found_at: self.now_label.clone(),
                queue_secs: self.ready_at.map(|r| self.now.saturating_sub(r) as u32),
                load_secs: None,
                duration_secs: None,
                left_early: false,
                my_hero: None,
                roster: Vec::new(),
                deaths: Vec::new(),
                hit_reg: HitReg::default(),
                network: Network {
                    nearest_relays: self.nearest_relays.clone(),
                    ..Network::default()
                },
                performance: Performance::default(),
            });
            self.dirty = true;
            return;
        }
        if !self.active() {
            // The disconnect summary for the match server is printed after
            // the End phase, so let it through once more.
            if self.report.as_ref().is_some_and(|r| r.phase == MatchPhase::Ended) {
                self.feed_connection_summary(body);
            }
            return;
        }
        if self.feed_match_line(body) {
            self.dirty = true;
        }
        // Keep the running duration fresh while the game is live.
        if let (Some(start), Some(r)) = (self.started_at, self.report.as_mut()) {
            let end = self.ended_at.unwrap_or(self.now);
            let d = Some(end.saturating_sub(start) as u32);
            if r.duration_secs != d {
                r.duration_secs = d;
                self.dirty = true;
            }
        }
    }

    fn feed_connection_summary(&mut self, body: &str) {
        static QUALITY_RE: LazyLock<Regex> = LazyLock::new(|| {
            Regex::new(r"^\[Networking\]\s+Quality:\s+([\d.]+)%\s+\(Dropped:([\d.]+)%").unwrap()
        });
        if let (Some(c), Some(r)) = (QUALITY_RE.captures(body), self.report.as_mut()) {
            if r.network.quality_pct.is_none() {
                r.network.quality_pct = c[1].parse().ok();
                r.network.dropped_pct = c[2].parse().ok();
                self.dirty = true;
            }
        }
    }

    /// Returns true if the report changed.
    fn feed_match_line(&mut self, body: &str) -> bool {
        static PHYSICS_RE: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"^\[Client\] Created physics for (\w+)").unwrap());
        static PLAYERS_RE: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"^\[Client\] Players: (\d+)").unwrap());
        static BUILD_RE: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"^\[Client\] Build: (\d+)").unwrap());
        static CAMERA_RE: LazyLock<Regex> = LazyLock::new(|| {
            Regex::new(r#"VMDL Camera Pose Success! "models/heroes_(?:wip|staging)/([a-z0-9_]+)/"#)
                .unwrap()
        });
        static HIT_RE: LazyLock<Regex> = LazyLock::new(|| {
            Regex::new(r"^Bullet Hit Mismatch: client hit entity#\d+/(\w+), server hit #\d+/(\w+)")
                .unwrap()
        });
        static RELAY_RE: LazyLock<Regex> = LazyLock::new(|| {
            Regex::new(r"Selecting ([a-z]+[0-9]?)#\d+ \([^)]*\) as primary\.\s+\(Ping = (\d+)")
                .unwrap()
        });
        static NET_PING_RE: LazyLock<Regex> = LazyLock::new(|| {
            Regex::new(r"Network ping \(ms\)[ .]*: P5:\d+\s+P50:(\d+)\s+P95:(\d+)").unwrap()
        });
        static JITTER_RE: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"Jitter \(ms\)[ .]*: P50:\d+\s+P99:(\d+)").unwrap());
        static ON_TIME_RE: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"Arrived on time[ .]*: \d+ \(([\d.]+)%\)").unwrap());
        static FPS_RE: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"^\[VProf\] FPS: Avg=([\d.]+), P1=([\d.]+)").unwrap());

        let now = self.now;
        let alive = self.dead_since.is_none();
        let since_start = self.since_start();
        let Some(r) = self.report.as_mut() else {
            return false;
        };

        if let Some(c) = PHASE_RE.captures(body) {
            match &c[1] {
                "MatchIntro" | "WaitForMapToLoad" => r.phase = MatchPhase::Intro,
                "GameInProgress" => {
                    r.phase = MatchPhase::InProgress;
                    if self.started_at.is_none() {
                        self.started_at = Some(now);
                        r.load_secs = self.found_at.map(|f| now.saturating_sub(f) as u32);
                    }
                }
                "PostGame" => {
                    r.phase = MatchPhase::PostGame;
                    self.ended_at.get_or_insert(now);
                }
                "End" => r.phase = MatchPhase::Ended,
                _ => return false,
            }
            return true;
        }
        if body.contains("Disconnected from server:") || body.contains("Disconnecting from server:") {
            if r.phase == MatchPhase::InProgress {
                r.left_early = true;
                self.ended_at.get_or_insert(now);
            }
            if r.phase != MatchPhase::Loading {
                r.phase = MatchPhase::Ended;
            }
            return true;
        }
        if let Some(c) = PHYSICS_RE.captures(body) {
            r.map = Some(c[1].to_owned());
            return true;
        }
        if let Some(c) = PLAYERS_RE.captures(body) {
            r.players = c[1].parse().ok();
            return true;
        }
        if let Some(c) = BUILD_RE.captures(body) {
            r.build = c[1].parse().ok();
            return true;
        }
        if let Some(c) = RELAY_RE.captures(body) {
            r.network.relay = Some(c[1].to_owned());
            r.network.relay_ping = c[2].parse().ok();
            return true;
        }
        if let Some(c) = CAMERA_RE.captures(body) {
            let hero = hero_codename(&c[1]);
            if self.started_at.is_none() {
                return false;
            }
            if alive {
                match &r.my_hero {
                    None => r.my_hero = Some(hero),
                    // The killcam can load a moment before the death itself.
                    Some(mine) if *mine != hero => self.pending_spectate = Some((now, hero)),
                    Some(_) => {}
                }
            } else if let Some(d) = r.deaths.last_mut() {
                if r.my_hero.as_deref() != Some(&hero) {
                    d.spectated = Some(hero);
                }
            }
            return true;
        }
        if body.starts_with("[Prediction] Shutdown prediction for player slot")
            && r.phase == MatchPhase::InProgress
        {
            self.dead_since = Some(now);
            let spectated = self
                .pending_spectate
                .take()
                .filter(|(t, _)| now.saturating_sub(*t) <= 10)
                .map(|(_, hero)| hero);
            r.deaths.push(Death {
                at: self.now_label.clone(),
                match_time: since_start,
                respawn_secs: None,
                spectated,
            });
            return true;
        }
        if body.starts_with("[Prediction] Added prediction for player slot") {
            if let (Some(since), Some(d)) = (self.dead_since.take(), r.deaths.last_mut()) {
                d.respawn_secs = Some(now.saturating_sub(since) as u32);
                return true;
            }
            return false;
        }
        if r.phase == MatchPhase::Loading {
            if let Some(c) = HERO_MODEL_RE.captures(body) {
                let hero = hero_codename(&c[1]);
                if !r.roster.contains(&hero) {
                    r.roster.push(hero);
                    return true;
                }
                return false;
            }
        }
        if let Some(c) = HIT_RE.captures(body) {
            match (&c[1] == "worldent", &c[2] == "worldent") {
                (false, true) => r.hit_reg.lost.add(&c[1]),
                (true, false) => r.hit_reg.gained.add(&c[2]),
                _ => r.hit_reg.swapped += 1,
            }
            return true;
        }
        if body.contains("Slamming client tick to server tick") {
            r.network.tick_resyncs += 1;
            return true;
        }
        if body.starts_with("Fell out of shadow map cache") {
            r.performance.shadow_overflows += 1;
            return true;
        }
        if body.starts_with("[SceneSystem] Exceeded maximum number visible") {
            r.performance.scene_limit_hits += 1;
            return true;
        }

        // Periodic engine summaries; the latest one wins.
        if self.started_at.is_none() {
            return false;
        }
        if body.contains("UPSTREAM (client->server)") {
            self.in_downstream = false;
        } else if body.contains("DOWNSTREAM (server->client)") {
            self.in_downstream = true;
        }
        if let Some(c) = NET_PING_RE.captures(body) {
            r.network.ping_p50 = c[1].parse().ok();
            r.network.ping_p95 = c[2].parse().ok();
            return true;
        }
        if self.in_downstream {
            if let Some(c) = JITTER_RE.captures(body) {
                r.network.jitter_p99 = c[1].parse().ok();
                return true;
            }
            if let Some(c) = ON_TIME_RE.captures(body) {
                r.network.ticks_on_time_pct = c[1].parse().ok();
                return true;
            }
        }
        if let Some(c) = FPS_RE.captures(body) {
            r.performance.fps_avg = c[1].parse().ok();
            r.performance.fps_p1 = c[2].parse().ok();
            return true;
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Trimmed from a real Street Brawl `console.log`.
    const SAMPLE: &str = r#"10/12 21:04:52 [SteamNetSockets] Ping location: sto=12+1,sto2=12+1,ams=22+2,dfra=23+2,fra=24+2/25+2,waw=29+2/27+1,iad=93+9
10/12 21:05:49 [Client] VMDL Camera Pose Success! "models/heroes_wip/wraith/wraith.vmdl" has loaded camera poses from vmdl:  "near_" Poses: 1
10/12 21:06:10 [GCClient] Send msg 9142 (k_EMsgClientToGCPartySetReadyState), 92 bytes
10/12 21:07:16 Lobby 102115458703695524 for Match 115538098 created
10/12 21:07:17 [SteamNetSockets] [#508706423 SDR server steamid:90294681371448350 vport 0] Selecting dfra#24 (89.222.108.161:27038) as primary.  (Ping = 24 = 24+0+0 (front+interior+remote).  Rank=1 Score=26)
10/12 21:07:18 [Client] Map: "start"
10/12 21:07:18 [Client] Players: 7 (0 bots) / 31 humans
10/12 21:07:18 [Client] Build: 10932 (revision 11112755)
10/12 21:07:18 [ResourceSystem] Failed loading resource "models/heroes_wip/bookworm/clips/ui_hero_reveal.vnmclip_c" (ERROR_FILEOPEN: File not found)
10/12 21:07:18 [ResourceSystem] Failed loading resource "models/heroes_wip/mcginnis/turret/clips/ui_hero_turret_02_reveal.vnmclip_c" (ERROR_FILEOPEN: File not found)
10/12 21:07:19 [ResourceSystem] Failed loading resource "models/heroes_staging/hornet_v3/clips/ui_crow_1_reveal.vnmclip_c" (ERROR_FILEOPEN: File not found)
10/12 21:07:19 [ResourceSystem] Failed loading resource "models/heroes_staging/hornet_v3/clips/ui_crow_2_reveal.vnmclip_c" (ERROR_FILEOPEN: File not found)
10/12 21:07:20 OnGameStateChanged: WaitingForPlayersToJoin (2)
10/12 21:07:40 OnGameStateChanged: MatchIntro (4)
10/12 21:07:46 [Client] Created physics for dl_midtown
10/12 21:07:46 OnGameStateChanged: WaitForMapToLoad (5)
10/12 21:07:47 OnGameStateChanged: GameInProgress (7)
10/12 21:07:47 [Client] Camera Pose Node "gunaim_00" has a noticeable height overshoot vs the standing pivot ( -50.000004 ), which can result in bad game feel. Zeroing.
 VMDL Camera Pose Success! "models/heroes_wip/ratking/ratking.vmdl" has loaded camera poses from vmdl:  "near_" Poses: 1
10/12 21:09:02 Bullet Hit Mismatch: client hit entity#3014/npc_trooper, server hit #74/player
10/12 21:09:31 Bullet Hit Mismatch: client hit entity#78/player, server hit #0/worldent
10/12 21:10:33 [Client] Camera Pose Node "near_02" has a noticeable height overshoot vs the standing pivot ( 4.599988 ), which can result in bad game feel. Zeroing.
 VMDL Camera Pose Success! "models/heroes_wip/bookworm/bookworm.vmdl" has loaded camera poses from vmdl:  "near_" Poses: 3
10/12 21:10:33 [Prediction] Shutdown prediction for player slot 2.  3 predictable entities and 0 client-created entities
10/12 21:10:54 [Prediction] Added prediction for player slot 2 (Hampster)
10/12 21:11:20 [Client] Slamming client tick to server tick.  abs( server tick 15519 - client tick 15514 = 5 ) > ( cl_clockdrift_max_ticks 3 + sim ticks 1 = 4 )
10/12 21:13:16 Bullet Hit Mismatch: client hit entity#0/worldent, server hit #71/player
10/12 21:15:36 Bullet Hit Mismatch: client hit entity#0/worldent, server hit #1809/npc_boss_tier2
10/12 21:16:03 Fell out of shadow map cache! More than 32 shadowed lights rendering in this frame!
10/12 21:16:57 OnGameStateChanged: PostGame (8)
10/12 21:16:57 [VProf] FPS: Avg=159.2, P1=99.7
10/12 21:16:57 [Client]     UPSTREAM (client->server):
10/12 21:16:57 [Client]           Jitter (ms) . . . . . : P50:1   P99:19
10/12 21:16:57 [Client]         Network ping (ms) . . . : P5:22   P50:22   P95:23
10/12 21:16:57 [Client]     DOWNSTREAM (server->client):
10/12 21:16:57 [Client]           Arrived on time . . . : 2866 (99.9%)   41 (1.4%) below desired recv margin
10/12 21:16:57 [Client]           Jitter (ms) . . . . . : P50:0   P99:3
10/12 21:17:07 OnGameStateChanged: End (11)
10/12 21:17:07 [Client] Disconnecting from server: NETWORK_DISCONNECT_DISCONNECT_BY_USER
10/12 21:17:07 [Networking]             Quality:  100%  (Dropped:0.00%  WeirdSeq:0.00%)
10/12 21:17:08 [Client] Created physics for dl_hideout
10/12 21:17:12 OnGameStateChanged: GameInProgress (7)"#;

    fn run(log: &str) -> MatchReport {
        let mut t = MatchTracker::default();
        log.lines().for_each(|l| t.feed(l));
        t.report().cloned().expect("a match")
    }

    #[test]
    fn keeps_earlier_matches_until_taken() {
        let mut t = MatchTracker::default();
        SAMPLE.lines().for_each(|l| t.feed(l));
        assert!(t.take_finished().is_empty());
        t.feed("10/12 21:30:00 Lobby 1 for Match 2 created");
        let finished = t.take_finished();
        assert_eq!(finished.len(), 1);
        assert_eq!(finished[0].match_id, 115_538_098);
        assert_eq!(finished[0].phase, MatchPhase::Ended);
        assert_eq!(t.report().map(|r| r.match_id), Some(2));
        assert!(t.take_finished().is_empty());
    }

    #[test]
    fn builds_report_from_real_lines() {
        let r = run(SAMPLE);
        assert_eq!(r.match_id, 115_538_098);
        assert_eq!(r.lobby_id, 102_115_458_703_695_524);
        assert_eq!(r.build, Some(10932));
        assert_eq!(r.map.as_deref(), Some("dl_midtown"));
        assert_eq!(r.players, Some(7));
        assert_eq!(r.phase, MatchPhase::Ended);
        assert_eq!(r.queue_secs, Some(66));
        assert_eq!(r.load_secs, Some(31));
        assert_eq!(r.duration_secs, Some(9 * 60 + 10));
        assert!(!r.left_early);
        assert_eq!(r.my_hero.as_deref(), Some("ratking"));
        assert_eq!(r.roster, ["bookworm", "forge", "hornet"]);
        assert_eq!(
            r.deaths,
            [Death {
                at: "21:10:33".into(),
                match_time: 166,
                respawn_secs: Some(21),
                spectated: Some("bookworm".into()),
            }]
        );
        assert_eq!(r.hit_reg.lost, HitCounts { hero: 1, ..HitCounts::default() });
        assert_eq!(
            r.hit_reg.gained,
            HitCounts { hero: 1, objective: 1, ..HitCounts::default() }
        );
        assert_eq!(r.hit_reg.swapped, 1);
        assert_eq!(r.network.relay.as_deref(), Some("dfra"));
        assert_eq!(r.network.relay_ping, Some(24));
        assert_eq!((r.network.ping_p50, r.network.ping_p95), (Some(22), Some(23)));
        assert_eq!(r.network.jitter_p99, Some(3));
        assert_eq!(r.network.ticks_on_time_pct, Some(99.9));
        assert_eq!(r.network.quality_pct, Some(100.0));
        assert_eq!(r.network.tick_resyncs, 1);
        assert_eq!(r.network.nearest_relays[0], ("sto".into(), 12));
        assert_eq!(r.performance.fps_avg, Some(159.2));
        assert_eq!(r.performance.shadow_overflows, 1);
    }

    #[test]
    fn disconnect_mid_game_is_left_early() {
        let log = "10/12 21:07:16 Lobby 1 for Match 2 created\n\
                   10/12 21:07:47 OnGameStateChanged: GameInProgress (7)\n\
                   10/12 21:09:47 [Client] Disconnected from server: NETWORK_DISCONNECT_TIMEOUT";
        let r = run(log);
        assert!(r.left_early);
        assert_eq!(r.phase, MatchPhase::Ended);
        assert_eq!(r.duration_secs, Some(120));
    }

    #[test]
    fn ignores_hideout_without_a_match() {
        let mut t = MatchTracker::default();
        t.feed("10/12 21:04:54 OnGameStateChanged: GameInProgress (7)");
        t.feed("10/12 21:04:55 [Prediction] Shutdown prediction for player slot 0.");
        assert!(t.report().is_none());
    }

    /// Run against a real log:
    /// `DEADLOCK_CONSOLE_LOG=path/to/console.log cargo test real_log -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn real_log() {
        let path = std::env::var("DEADLOCK_CONSOLE_LOG").expect("DEADLOCK_CONSOLE_LOG");
        let bytes = std::fs::read(path).unwrap();
        let mut t = MatchTracker::default();
        let mut reports: Vec<MatchReport> = Vec::new();
        for line in String::from_utf8_lossy(&bytes).lines() {
            t.feed(line);
            if let Some(r) = t.report() {
                match reports.last_mut() {
                    Some(last) if last.match_id == r.match_id => *last = r.clone(),
                    _ => reports.push(r.clone()),
                }
            }
        }
        println!("{}", serde_json::to_string_pretty(&reports).unwrap());
    }
}
