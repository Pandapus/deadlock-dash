//! Startup auto-update from the latest GitHub release.
//!
//! The release workflow (`.github/workflows/release.yml`) publishes a signed
//! NSIS installer plus a `latest.json` manifest; the endpoint and public key
//! live in `tauri.conf.json` under `plugins.updater`.

use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

/// Checks for a newer release in the background and, if there is one,
/// downloads and installs it, then restarts into the new version. On Windows
/// the installer closes the app itself and relaunches it when done.
///
/// Debug builds skip the check so `tauri dev` never replaces itself.
pub fn check_on_startup(app: AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        if let Err(e) = update(&app).await {
            eprintln!("Update check failed: {e}");
        }
    });
}

async fn update(app: &AppHandle) -> tauri_plugin_updater::Result<()> {
    let Some(update) = app.updater()?.check().await? else {
        return Ok(());
    };
    eprintln!(
        "Updating from {} to {}",
        update.current_version, update.version
    );
    update.download_and_install(|_, _| {}, || {}).await?;
    app.restart();
}
