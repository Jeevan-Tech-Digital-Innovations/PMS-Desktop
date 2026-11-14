//! Build/runtime configuration (docs/ARCHITECTURE.md section 1).
//!
//! Release builds read URLs only from compile-time `option_env!`; debug builds also honour runtime
//! environment variables, the dev auto sign-in and `PMS_DEV_FAST`.

use std::path::PathBuf;
use std::time::Duration;

pub const APP_IDENTIFIER: &str = "com.jeevantech.pms.desktop";
pub const KEYCHAIN_SERVICE: &str = "com.jeevantech.pms.desktop";
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

const DEFAULT_API_URL: &str = "http://localhost:8080/api/v1";
const DEFAULT_AXIS_URL: &str = "https://stagingaxisapi.enjev.com";
const DEFAULT_WEB_URL: &str = "https://stagingpms.enjev.com";

#[derive(Debug, Clone)]
pub struct Config {
    pub api_url: String,
    pub axis_url: String,
    pub web_url: String,
    /// Debug builds only.
    pub dev_email: Option<String>,
    /// Debug builds only. Never logged.
    pub dev_password: Option<String>,
    pub fast: bool,
    pub dev: bool,
    pub data_dir: PathBuf,
    pub timings: Timings,
}

/// Every interval the agent uses, in one place so `PMS_DEV_FAST` can shrink them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Timings {
    pub idle_after: Duration,
    pub idle_autostop: Duration,
    /// `Some` overrides the employee's `screenshotTimer`.
    pub screenshot_override: Option<Duration>,
    pub overtime_after: Duration,
    pub heartbeat: Duration,
    pub active_poll: Duration,
    pub app_poll: Duration,
    pub app_flush: Duration,
    pub activity_sample: Duration,
    pub power_check: Duration,
    pub settings_ttl: Duration,
    pub web_start_grace: Duration,
}

impl Timings {
    pub fn normal() -> Self {
        Self {
            idle_after: Duration::from_secs(5 * 60),
            idle_autostop: Duration::from_secs(60 * 60),
            screenshot_override: None,
            overtime_after: Duration::from_secs(8 * 3600),
            heartbeat: Duration::from_secs(30),
            active_poll: Duration::from_secs(30),
            app_poll: Duration::from_secs(5),
            app_flush: Duration::from_secs(60),
            activity_sample: Duration::from_secs(10),
            power_check: Duration::from_secs(5),
            settings_ttl: Duration::from_secs(15 * 60),
            web_start_grace: Duration::from_secs(15),
        }
    }

    pub fn fast() -> Self {
        Self {
            idle_after: Duration::from_secs(30),
            idle_autostop: Duration::from_secs(2 * 60),
            screenshot_override: Some(Duration::from_secs(60)),
            overtime_after: Duration::from_secs(3 * 60),
            ..Self::normal()
        }
    }
}

fn pick(runtime_key: &str, compiled: Option<&'static str>, default: &str) -> String {
    if cfg!(debug_assertions)
        && let Ok(v) = std::env::var(runtime_key)
        && !v.trim().is_empty()
    {
        return v.trim().trim_end_matches('/').to_string();
    }
    compiled.unwrap_or(default).trim().trim_end_matches('/').to_string()
}

fn dev_var(key: &str) -> Option<String> {
    if !cfg!(debug_assertions) {
        return None;
    }
    std::env::var(key)
        .ok()
        .map(|v| v.trim().trim_matches('"').trim_matches('\'').to_string())
        .filter(|v| !v.is_empty())
}

pub fn data_dir() -> PathBuf {
    // Same folder Tauri's `app_data_dir()` resolves to: <OS data dir>/<identifier>.
    dirs::data_dir().unwrap_or_else(std::env::temp_dir).join(APP_IDENTIFIER)
}

impl Config {
    pub fn load() -> Self {
        let dev = cfg!(debug_assertions);
        let fast = dev_var("PMS_DEV_FAST").is_some_and(|v| v == "1" || v.eq_ignore_ascii_case("true"));
        Self {
            api_url: pick("PMS_API_URL", option_env!("PMS_API_URL"), DEFAULT_API_URL),
            axis_url: pick("AXIS_API_URL", option_env!("AXIS_API_URL"), DEFAULT_AXIS_URL),
            web_url: pick("PMS_WEB_URL", option_env!("PMS_WEB_URL"), DEFAULT_WEB_URL),
            dev_email: dev_var("PMS_DEV_EMAIL"),
            dev_password: dev_var("PMS_DEV_PASSWORD"),
            fast,
            dev,
            data_dir: data_dir(),
            timings: if fast { Timings::fast() } else { Timings::normal() },
        }
    }
}

/// `"windows"` / `"macos"` (contract `app_info.platform` and Axis `platform`).
pub fn platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

/// `PMS-Desktop/<version> (<os>)`. Staging Cloudflare blocks library default agents (403 "error code: 1010").
/// PMS-API also keys `sourceType = DESKTOP_APP` off the "pms-desktop" substring.
pub fn user_agent() -> String {
    let os = match platform() {
        "windows" => "Windows",
        "macos" => "macOS",
        _ => "Linux",
    };
    format!("PMS-Desktop/{VERSION} ({os})")
}

pub fn device_name() -> String {
    hostname::get()
        .ok()
        .and_then(|h| h.into_string().ok())
        .filter(|h| !h.is_empty())
        .unwrap_or_else(|| "PMS Desktop".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_agent_shape() {
        let ua = user_agent();
        assert!(ua.starts_with("PMS-Desktop/"));
        assert!(ua.to_lowercase().contains("pms-desktop"));
        assert!(ua.ends_with(')'));
    }

    #[test]
    fn fast_timings_are_short() {
        let f = Timings::fast();
        assert_eq!(f.idle_after.as_secs(), 30);
        assert_eq!(f.idle_autostop.as_secs(), 120);
        assert_eq!(f.screenshot_override.map(|d| d.as_secs()), Some(60));
        assert_eq!(f.overtime_after.as_secs(), 180);
        assert_eq!(f.heartbeat.as_secs(), 30);
    }
}
