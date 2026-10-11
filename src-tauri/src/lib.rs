mod api;
mod console_log;
mod steam;

use std::path::PathBuf;

use tauri::{AppHandle, State};

use api::DeadlockApi;
use console_log::ConsoleWatcher;

#[tauri::command]
fn detect_environment() -> steam::Environment {
    steam::detect()
}

#[tauri::command]
fn start_console_watch(app: AppHandle, watcher: State<'_, ConsoleWatcher>, path: String) {
    watcher.start(app, PathBuf::from(path));
}

#[tauri::command]
fn stop_console_watch(watcher: State<'_, ConsoleWatcher>) {
    watcher.stop();
}

#[tauri::command]
async fn api_get(
    api: State<'_, DeadlockApi>,
    path: String,
    query: Option<Vec<(String, String)>>,
) -> Result<serde_json::Value, String> {
    api.get(&path, &query.unwrap_or_default()).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DeadlockApi::new())
        .manage(ConsoleWatcher::default())
        .invoke_handler(tauri::generate_handler![
            detect_environment,
            start_console_watch,
            stop_console_watch,
            api_get,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
