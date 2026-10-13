//! Tails Deadlock's `console.log` (written when the game is launched with
//! `-condebug`) and forwards new lines plus a few recognised events to the UI.

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use regex::Regex;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::db::{self, Store};
use crate::match_report::{MatchPhase, MatchReport, MatchTracker};

const POLL_INTERVAL: Duration = Duration::from_millis(500);
/// Upper bound on bytes read per poll so a huge backlog can't stall the UI.
const MAX_READ_PER_POLL: u64 = 4 * 1024 * 1024;

pub const EVENT_LINES: &str = "console://lines";
pub const EVENT_GAME: &str = "console://game-event";
pub const EVENT_STATUS: &str = "console://status";
pub const EVENT_MATCH: &str = "console://match-report";

/// Something recognised in the console output.
///
/// NOTE: the patterns in [`parse_line`] are educated guesses based on common
/// Source 2 console output and have NOT been checked against a real Deadlock
/// `console.log`. Capture a log from a real match, look at it in the app's
/// console panel, and adjust them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum GameEvent {
    MapLoaded { map: String },
    ServerConnected { address: String },
    Disconnected { reason: String },
    MatchId { match_id: u64 },
}

pub fn parse_line(line: &str) -> Option<GameEvent> {
    static MATCH_ID_RE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?i)\bmatch[ _]?id\b\D{0,8}(\d{6,20})").unwrap());
    static MAP_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(
            r#"(?i)(?:\bloading\s+map\s+"?|\bmap(?:\s*name)?\s*[:=]\s*"?|\bmap\s+")([a-z][a-z0-9_]{2,})"#,
        )
        .unwrap()
    });
    static CONNECTED_RE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?i)\bconnected to\s+'?([^\s']+)").unwrap());
    static DISCONNECT_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)\b(?:disconnect(?:ed)?\s*[:(]|disconnected\s+from\b)\s*(.*)$").unwrap()
    });

    if let Some(c) = MATCH_ID_RE.captures(line) {
        if let Ok(match_id) = c[1].parse() {
            return Some(GameEvent::MatchId { match_id });
        }
    }
    if let Some(c) = MAP_RE.captures(line) {
        // "start" is a placeholder the client prints while connecting.
        if !c[1].eq_ignore_ascii_case("start") {
            return Some(GameEvent::MapLoaded {
                map: c[1].to_ascii_lowercase(),
            });
        }
    }
    if let Some(c) = CONNECTED_RE.captures(line) {
        return Some(GameEvent::ServerConnected {
            address: c[1].to_owned(),
        });
    }
    if let Some(c) = DISCONNECT_RE.captures(line) {
        return Some(GameEvent::Disconnected {
            reason: c[1]
                .trim_matches(|ch: char| ch == '(' || ch == ')' || ch.is_whitespace())
                .to_owned(),
        });
    }
    None
}

/// Incremental reader that returns complete lines appended since the last poll.
#[derive(Debug, Default)]
struct Tail {
    offset: u64,
    partial: Vec<u8>,
}

#[derive(Debug, Default)]
struct TailUpdate {
    /// The file shrank (the game was restarted and overwrote it).
    reset: bool,
    lines: Vec<String>,
}

impl Tail {
    fn poll(&mut self, path: &Path) -> io::Result<TailUpdate> {
        let mut file = File::open(path)?;
        let len = file.metadata()?.len();
        let mut update = TailUpdate::default();
        if len < self.offset {
            self.offset = 0;
            self.partial.clear();
            update.reset = true;
        }
        if len == self.offset {
            return Ok(update);
        }

        file.seek(SeekFrom::Start(self.offset))?;
        let mut buf = Vec::new();
        file.take(MAX_READ_PER_POLL).read_to_end(&mut buf)?;
        self.offset += buf.len() as u64;
        self.partial.extend_from_slice(&buf);

        // Keep a trailing unterminated line for the next poll.
        if let Some(last_newline) = self.partial.iter().rposition(|&b| b == b'\n') {
            let rest = self.partial.split_off(last_newline + 1);
            let complete = std::mem::replace(&mut self.partial, rest);
            update.lines = String::from_utf8_lossy(&complete)
                .lines()
                .map(|l| l.trim_end_matches('\r').to_owned())
                .filter(|l| !l.is_empty())
                .collect();
        }
        Ok(update)
    }
}

#[derive(Clone, Serialize)]
struct LinesPayload {
    lines: Vec<String>,
    reset: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "snake_case")]
enum WatchState {
    /// The file does not exist yet (game not launched with `-condebug`).
    Waiting,
    Watching,
    Error,
}

#[derive(Clone, Serialize)]
struct StatusPayload {
    path: PathBuf,
    state: WatchState,
    message: Option<String>,
}

/// Owns the background tailing thread; at most one runs at a time.
#[derive(Default)]
pub struct ConsoleWatcher {
    stop: Mutex<Option<Arc<AtomicBool>>>,
}

impl ConsoleWatcher {
    /// Reports are saved under `account_id` (the local player) when given.
    pub fn start(&self, app: AppHandle, path: PathBuf, account_id: Option<u32>) {
        let stop = Arc::new(AtomicBool::new(false));
        if let Some(previous) = self.stop.lock().unwrap().replace(stop.clone()) {
            previous.store(true, Ordering::Relaxed);
        }
        std::thread::spawn(move || watch(&app, &path, account_id, &stop));
    }

    pub fn stop(&self) {
        if let Some(stop) = self.stop.lock().unwrap().take() {
            stop.store(true, Ordering::Relaxed);
        }
    }
}

fn watch(app: &AppHandle, path: &Path, account_id: Option<u32>, stop: &AtomicBool) {
    let mut tail = Tail::default();
    let mut tracker = MatchTracker::default();
    let mut saved: Option<(u64, MatchPhase)> = None;
    let mut last_state: Option<(std::mem::Discriminant<WatchState>, Option<String>)> = None;
    let mut emit_status = |state: WatchState, message: Option<String>| {
        let key = (std::mem::discriminant(&state), message.clone());
        if last_state.as_ref() != Some(&key) {
            last_state = Some(key);
            let _ = app.emit(
                EVENT_STATUS,
                StatusPayload {
                    path: path.to_path_buf(),
                    state,
                    message,
                },
            );
        }
    };

    while !stop.load(Ordering::Relaxed) {
        match tail.poll(path) {
            Ok(update) => {
                emit_status(WatchState::Watching, None);
                if update.reset {
                    tracker = MatchTracker::default();
                    let _ = app.emit(EVENT_MATCH, tracker.report());
                }
                if update.reset || !update.lines.is_empty() {
                    for line in &update.lines {
                        tracker.feed(line);
                    }
                    for event in update.lines.iter().filter_map(|l| parse_line(l)) {
                        let _ = app.emit(EVENT_GAME, event);
                    }
                    let finished = tracker.take_finished();
                    let dirty = tracker.take_dirty();
                    if dirty {
                        let _ = app.emit(EVENT_MATCH, tracker.report());
                    }
                    save_reports(
                        app,
                        &finished,
                        dirty.then(|| tracker.report()).flatten(),
                        account_id,
                        &mut saved,
                    );
                    let _ = app.emit(
                        EVENT_LINES,
                        LinesPayload {
                            lines: update.lines,
                            reset: update.reset,
                        },
                    );
                }
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                tail = Tail::default();
                tracker = MatchTracker::default();
                emit_status(WatchState::Waiting, None);
            }
            Err(e) => emit_status(WatchState::Error, Some(e.to_string())),
        }
        std::thread::sleep(POLL_INTERVAL);
    }
}

/// Saves finished and in-progress reports. Tells the UI the history changed
/// only when a match finishes or changes phase, not on every report tweak.
fn save_reports(
    app: &AppHandle,
    finished: &[MatchReport],
    current: Option<&MatchReport>,
    account_id: Option<u32>,
    saved: &mut Option<(u64, MatchPhase)>,
) {
    let store = app.state::<Store>();
    let mut changed = false;
    for report in finished.iter().chain(current) {
        if let Err(e) = store.ingest_report(report, account_id) {
            eprintln!("Couldn't save report for match {}: {e}", report.match_id);
            continue;
        }
        let key = Some((report.match_id, report.phase));
        changed |= *saved != key;
        *saved = key;
    }
    if changed {
        let _ = app.emit(db::EVENT_CHANGED, ());
    }
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use super::*;

    fn temp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("deadlock-dash-{}-{name}", std::process::id()))
    }

    #[test]
    fn tail_returns_only_complete_new_lines() {
        let path = temp_path("tail.log");
        let mut file = File::create(&path).unwrap();
        let mut tail = Tail::default();

        write!(file, "first\r\nsecond\npart").unwrap();
        assert_eq!(tail.poll(&path).unwrap().lines, ["first", "second"]);

        writeln!(file, "ial").unwrap();
        assert_eq!(tail.poll(&path).unwrap().lines, ["partial"]);
        assert!(tail.poll(&path).unwrap().lines.is_empty());

        // Game restart overwrites the file.
        let mut file = File::create(&path).unwrap();
        writeln!(file, "fresh").unwrap();
        let update = tail.poll(&path).unwrap();
        assert!(update.reset);
        assert_eq!(update.lines, ["fresh"]);

        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn missing_file_is_not_found() {
        let err = Tail::default().poll(&temp_path("missing.log")).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::NotFound);
    }

    #[test]
    fn parses_guessed_patterns() {
        assert_eq!(
            parse_line("[Client] match_id: 41234567"),
            Some(GameEvent::MatchId {
                match_id: 41_234_567
            })
        );
        assert_eq!(
            parse_line(r#"Loading map "street_test""#),
            Some(GameEvent::MapLoaded {
                map: "street_test".into()
            })
        );
        assert_eq!(
            parse_line("CL:  Connected to '=[A:1:123:4567]'"),
            Some(GameEvent::ServerConnected {
                address: "=[A:1:123:4567]".into()
            })
        );
        assert_eq!(
            parse_line("Disconnect: (NETWORK_DISCONNECT_EXITING)"),
            Some(GameEvent::Disconnected {
                reason: "NETWORK_DISCONNECT_EXITING".into()
            })
        );
        assert_eq!(
            parse_line("Disconnected from server"),
            Some(GameEvent::Disconnected {
                reason: "server".into()
            })
        );
        assert_eq!(parse_line(r#"[Client] Map: "start""#), None);
        assert_eq!(parse_line("[Shaders] compiled 42 shaders"), None);
        assert_eq!(parse_line("Minimap texture loaded"), None);
        assert_eq!(parse_line("bind F10 disconnect"), None);
    }
}
