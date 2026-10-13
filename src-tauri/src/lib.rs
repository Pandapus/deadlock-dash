mod api;
mod console_log;
mod db;
mod live;
mod match_report;
mod steam;
mod updater;

use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager, State};

use api::DeadlockApi;
use console_log::ConsoleWatcher;
use db::Store;
use live::LiveFeed;

const DB_FILE: &str = "deadlock-dash.db";

#[tauri::command]
fn detect_environment() -> steam::Environment {
    steam::detect()
}

#[tauri::command]
fn start_console_watch(
    app: AppHandle,
    watcher: State<'_, ConsoleWatcher>,
    path: String,
    account_id: Option<u32>,
) {
    watcher.start(app, PathBuf::from(path), account_id);
}

#[tauri::command]
fn stop_console_watch(watcher: State<'_, ConsoleWatcher>) {
    watcher.stop();
}

/// Streams the live scoreboard of `match_id` from its spectator broadcast.
#[tauri::command]
fn start_live_feed(app: AppHandle, feed: State<'_, LiveFeed>, match_id: u64) {
    feed.start(app, match_id);
}

#[tauri::command]
fn stop_live_feed(feed: State<'_, LiveFeed>) {
    feed.stop();
}

#[tauri::command]
async fn api_get(
    api: State<'_, DeadlockApi>,
    path: String,
    query: Option<Vec<(String, String)>>,
) -> Result<serde_json::Value, String> {
    api.get(&path, &query.unwrap_or_default()).await
}

/// `/v1/players/{account_id}/match-history`, saved to the local database on
/// the way through. Returns the raw API response.
#[tauri::command]
async fn fetch_match_history(
    app: AppHandle,
    api: State<'_, DeadlockApi>,
    store: State<'_, Store>,
    account_id: u32,
) -> Result<serde_json::Value, String> {
    let raw = api
        .get(&format!("/v1/players/{account_id}/match-history"), &[])
        .await?;
    let entries: Vec<db::HistoryEntry> = serde_json::from_value(raw.clone())
        .map_err(|e| format!("unexpected match history: {e}"))?;
    store.ingest_history(account_id, &entries)?;
    let _ = app.emit(db::EVENT_CHANGED, ());
    Ok(raw)
}

/// Everything stored locally about one player: totals, heroes, recent
/// matches and the players they've shared matches with.
#[tauri::command]
async fn player_profile(
    store: State<'_, Store>,
    account_id: u32,
    limit: Option<u32>,
) -> Result<db::Profile, String> {
    store.profile(account_id, limit.unwrap_or(50))
}

#[tauri::command]
async fn db_status(store: State<'_, Store>) -> Result<db::Status, String> {
    store.status()
}

#[tauri::command]
async fn set_contribute(store: State<'_, Store>, contribute: bool) -> Result<(), String> {
    store.set_contribute(contribute)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let store = match app.path().app_data_dir() {
                Ok(dir) => Store::open(&dir.join(DB_FILE)),
                Err(e) => {
                    eprintln!("No app data directory ({e}); using an in-memory database");
                    Store::in_memory()
                }
            };
            app.manage(store);
            updater::check_on_startup(app.handle().clone());
            Ok(())
        })
        .manage(DeadlockApi::new())
        .manage(ConsoleWatcher::default())
        .manage(LiveFeed::new())
        .invoke_handler(tauri::generate_handler![
            detect_environment,
            start_console_watch,
            stop_console_watch,
            start_live_feed,
            stop_live_feed,
            api_get,
            fetch_match_history,
            player_profile,
            db_status,
            set_contribute,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
