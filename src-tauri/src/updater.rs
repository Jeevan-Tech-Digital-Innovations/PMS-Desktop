//! Automatic updates (docs/ARCHITECTURE.md section 11).
//!
//! Policy: check one minute after start-up and every 6 hours; download in the background and verify the
//! signature; **install only when no timer is running** and nothing is starting or stopping one (the install
//! then restarts the app). While a timer runs the update waits, and the tray offers "Restart to update (vX.Y.Z)".
//! On Ubuntu only an AppImage can replace itself: a `.deb` install is told "New version available — Download"
//! and the tray opens the release page instead.
//!
//! Disabled (logged once) unless the build has the signing public key (`UPDATER_PUBKEY`, compiled in) and the
//! Tauri config carries `plugins.updater` (CI writes it with the key; see README "Auto-update").

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use tauri::{AppHandle, Url};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::app::Core;
use crate::config;

/// Public repository the installers and `latest.json` are published to.
pub const RELEASES_REPO_URL: &str = "https://github.com/Jeevan-Tech-Digital-Innovations/PMS-Desktop-Releases";
const FIRST_CHECK_AFTER: Duration = Duration::from_secs(60);
const CHECK_EVERY: Duration = Duration::from_secs(6 * 3600);
/// How often a downloaded update looks for a moment to install (no timer running).
const INSTALL_TICK: Duration = Duration::from_secs(15);

/// Signing public key (the content of the `.pub` file `tauri signer generate` writes), compiled in by CI.
const PUBKEY: Option<&str> = option_env!("UPDATER_PUBKEY");
const ENDPOINT: Option<&str> = option_env!("UPDATER_ENDPOINT");

static ENABLED: AtomicBool = AtomicBool::new(false);

pub fn pubkey() -> &'static str {
    PUBKEY.map(str::trim).unwrap_or("")
}

/// Called once from `run()` with the answer to "is the updater plugin configured and registered".
pub fn set_enabled(on: bool) {
    ENABLED.store(on, Ordering::Relaxed);
}

pub fn is_staging() -> bool {
    config::APP_IDENTIFIER.ends_with(".staging")
}

/// Per-channel default of the `latest.json` URL; `UPDATER_ENDPOINT` (build time) overrides it. Pure.
pub fn endpoint_for(configured: Option<&str>, staging: bool) -> String {
    match configured.map(str::trim).filter(|s| !s.is_empty()) {
        Some(url) => url.to_string(),
        None if staging => format!("{RELEASES_REPO_URL}/releases/download/desktop-staging/latest.json"),
        None => format!("{RELEASES_REPO_URL}/releases/latest/download/latest.json"),
    }
}

pub fn endpoint() -> String {
    endpoint_for(ENDPOINT, is_staging())
}

/// Where a `.deb` user downloads the new version.
pub fn release_page(staging: bool) -> String {
    if staging { format!("{RELEASES_REPO_URL}/releases/tag/desktop-staging") } else { format!("{RELEASES_REPO_URL}/releases/latest") }
}

/// Ubuntu: only the AppImage (it sets `APPIMAGE`) can replace itself. Windows can always self-install.
pub fn can_self_install_for(linux: bool, appimage: bool) -> bool {
    !linux || appimage
}

pub fn can_self_install() -> bool {
    can_self_install_for(cfg!(target_os = "linux"), std::env::var_os("APPIMAGE").is_some())
}

/// Install now? Only with an update ready, no timer running and no operation in flight. Pure.
pub fn may_install(ready: bool, timer_running: bool, operation_in_flight: bool) -> bool {
    ready && !timer_running && !operation_in_flight
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Status {
    None,
    /// Downloaded and verified; installs when no timer runs, or on request.
    Ready(String),
    /// A newer version exists but this install cannot update itself (`.deb`): open the release page.
    Download(String),
}

impl Status {
    /// Tray entry: `(menu id, label)`.
    pub fn menu_entry(&self) -> Option<(&'static str, String)> {
        match self {
            Status::None => None,
            Status::Ready(v) => Some(("update_restart", format!("Restart to update (v{v})"))),
            Status::Download(_) => Some(("update_download", "New version available — Download".to_string())),
        }
    }
}

struct Inner {
    status: Status,
    ready: Option<(Update, Vec<u8>)>,
}

static STATE: Mutex<Inner> = Mutex::new(Inner { status: Status::None, ready: None });

fn state() -> MutexGuard<'static, Inner> {
    STATE.lock().unwrap_or_else(|p| p.into_inner())
}

pub fn status() -> Status {
    state().status.clone()
}

fn is_ready() -> bool {
    state().ready.is_some()
}

pub fn spawn(app: AppHandle, core: Arc<Core>) {
    tauri::async_runtime::spawn(async move { run(app, core).await });
}

async fn run(app: AppHandle, core: Arc<Core>) {
    if !ENABLED.load(Ordering::Relaxed) {
        if pubkey().is_empty() {
            log::info!("updater disabled: this build has no UPDATER_PUBKEY");
        } else {
            log::info!("updater disabled: plugins.updater is missing from the Tauri config");
        }
        return;
    }
    log::info!("updater enabled: {} (self-install: {})", endpoint(), can_self_install());
    tokio::time::sleep(FIRST_CHECK_AFTER).await;
    let mut last_check: Option<std::time::Instant> = None;
    loop {
        if last_check.is_none_or(|t| t.elapsed() >= CHECK_EVERY) {
            last_check = Some(std::time::Instant::now());
            if let Err(e) = check_and_download(&app).await {
                log::info!("update check failed: {e}");
            }
        }
        try_install(&app, &core);
        tokio::time::sleep(INSTALL_TICK).await;
    }
}

async fn check_and_download(app: &AppHandle) -> Result<(), String> {
    let url = Url::parse(&endpoint()).map_err(|e| e.to_string())?;
    let updater = app
        .updater_builder()
        .endpoints(vec![url])
        .and_then(|b| b.build())
        .map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        log::info!("no update available");
        return Ok(());
    };
    let version = update.version.clone();
    if matches!(&state().status, Status::Ready(v) | Status::Download(v) if *v == version) {
        return Ok(());
    }
    if !can_self_install() {
        log::info!("version {version} is available (this install cannot update itself)");
        state().status = Status::Download(version);
        return Ok(());
    }
    log::info!("downloading update {version}");
    let bytes = update.download(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    log::info!("update {version} downloaded and verified");
    let mut st = state();
    st.status = Status::Ready(version);
    st.ready = Some((update, bytes));
    Ok(())
}

/// Install when the policy allows: nothing in flight (we hold the operation lock, so no timer can be started or
/// stopped meanwhile) and no timer running.
fn try_install(app: &AppHandle, core: &Arc<Core>) {
    if !is_ready() {
        return;
    }
    let guard = core.try_lock_op();
    if !may_install(true, core.is_running(), guard.is_none()) {
        return;
    }
    install(app);
    drop(guard);
}

/// Take the downloaded update and install it. On Windows the installer takes over and the process ends here; on
/// Ubuntu (AppImage) the file is replaced and the app restarts.
fn install(app: &AppHandle) {
    let Some((update, bytes)) = state().ready.take() else { return };
    let version = update.version.clone();
    log::info!("installing update {version}");
    match update.install(&bytes) {
        Ok(()) => app.request_restart(),
        Err(e) => {
            log::warn!("update {version} could not be installed: {e}");
            state().status = Status::None;
        }
    }
}

/// The tray's "Restart to update": stops a running timer first (the caller has confirmed that).
pub async fn restart_now(app: AppHandle, core: Arc<Core>) {
    if core.is_running() {
        core.shutdown().await;
    }
    let _g = core.lock_op().await;
    install(&app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_defaults_per_channel() {
        assert_eq!(
            endpoint_for(None, false),
            "https://github.com/Jeevan-Tech-Digital-Innovations/PMS-Desktop-Releases/releases/latest/download/latest.json"
        );
        assert_eq!(
            endpoint_for(Some("  "), true),
            "https://github.com/Jeevan-Tech-Digital-Innovations/PMS-Desktop-Releases/releases/download/desktop-staging/latest.json"
        );
        assert_eq!(endpoint_for(Some(" https://example.test/latest.json "), false), "https://example.test/latest.json");
        assert!(Url::parse(&endpoint_for(None, true)).is_ok());
    }

    #[test]
    fn install_only_when_idle() {
        assert!(may_install(true, false, false));
        assert!(!may_install(false, false, false));
        assert!(!may_install(true, true, false), "a timer is running");
        assert!(!may_install(true, false, true), "a timer is being started or stopped");
    }

    #[test]
    fn only_appimage_updates_itself_on_linux() {
        assert!(!can_self_install_for(true, false), ".deb");
        assert!(can_self_install_for(true, true), "AppImage");
        assert!(can_self_install_for(false, false), "Windows");
    }

    #[test]
    fn tray_entries() {
        assert_eq!(Status::None.menu_entry(), None);
        assert_eq!(Status::Ready("2.0.1".into()).menu_entry(), Some(("update_restart", "Restart to update (v2.0.1)".into())));
        let (id, label) = Status::Download("2.0.1".into()).menu_entry().unwrap();
        assert_eq!(id, "update_download");
        assert!(label.starts_with("New version available"));
        assert!(release_page(false).ends_with("/releases/latest"));
        assert!(release_page(true).ends_with("/releases/tag/desktop-staging"));
    }
}
