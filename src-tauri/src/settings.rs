//! Employee tracking settings from `GET /employees/me`, cached for 15 minutes.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::api::Api;
use crate::types::{IdleNoteMode, TrackingMode};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrackApps {
    Off,
    AppsOnly,
    UrlsOnly,
    Both,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TrackingSettings {
    /// PMS-API employee id (axis user id); used with the Axis user id to match task assignment.
    pub employee_id: Option<String>,
    pub screenshot_interval: Duration,
    pub blur: bool,
    pub screenshot_notifications: bool,
    pub track_apps: TrackApps,
    pub idle_note: IdleNoteMode,
    pub mode: TrackingMode,
}

impl Default for TrackingSettings {
    fn default() -> Self {
        Self {
            employee_id: None,
            screenshot_interval: Duration::from_secs(600),
            blur: false,
            screenshot_notifications: true,
            track_apps: TrackApps::Both,
            idle_note: IdleNoteMode::Off,
            mode: TrackingMode::Visible,
        }
    }
}

/// `idleNotesSetting`: "Disabled" → off, "... Not Mandatory" → optional, "... Mandatory" → mandatory.
pub fn parse_idle_note(s: Option<&str>) -> IdleNoteMode {
    let s = s.unwrap_or("").trim().to_lowercase();
    if s.is_empty() || s.contains("disable") || s == "off" || s == "no" {
        IdleNoteMode::Off
    } else if s.contains("not mandatory") || s.contains("optional") {
        IdleNoteMode::Optional
    } else if s.contains("mandatory") || s.contains("required") {
        IdleNoteMode::Mandatory
    } else if s.contains("enable") {
        IdleNoteMode::Optional
    } else {
        IdleNoteMode::Off
    }
}

/// `screenshotTimer`: "5min." / "10min." / "15min." → minutes. Unknown → 10 min.
pub fn parse_screenshot_interval(s: Option<&str>) -> Duration {
    let digits: String = s.unwrap_or("").chars().skip_while(|c| !c.is_ascii_digit()).take_while(char::is_ascii_digit).collect();
    match digits.parse::<u64>() {
        Ok(m) if (1..=120).contains(&m) => Duration::from_secs(m * 60),
        _ => Duration::from_secs(600),
    }
}

pub fn parse_track_apps(s: Option<&str>) -> TrackApps {
    let s = s.unwrap_or("").trim().to_lowercase();
    if s.is_empty() {
        return TrackApps::Both;
    }
    if s == "off" || s.contains("disable") {
        TrackApps::Off
    } else if s.contains("both") || (s.contains("apps") && s.contains("url")) {
        TrackApps::Both
    } else if s.contains("apps only") {
        TrackApps::AppsOnly
    } else if s.contains("urls only") || s.contains("url only") {
        TrackApps::UrlsOnly
    } else {
        TrackApps::Both
    }
}

pub fn parse_settings(v: &Value) -> TrackingSettings {
    let s = |k: &str| v.get(k).and_then(Value::as_str);
    TrackingSettings {
        employee_id: v.get("id").and_then(|id| match id {
            Value::String(s) => Some(s.clone()),
            Value::Null => None,
            other => Some(other.to_string()),
        }),
        screenshot_interval: parse_screenshot_interval(s("screenshotTimer")),
        blur: s("screenshotBlur").is_some_and(|b| b.trim().eq_ignore_ascii_case("on")),
        screenshot_notifications: !s("screenshotNotifications").is_some_and(|b| b.trim().to_lowercase().starts_with("disable")),
        track_apps: parse_track_apps(s("trackAppsUrls")),
        idle_note: parse_idle_note(s("idleNotesSetting")),
        mode: if s("trackingScenario").is_some_and(|m| m.trim().eq_ignore_ascii_case("silent")) {
            TrackingMode::Silent
        } else {
            TrackingMode::Visible
        },
    }
}

pub struct SettingsCache {
    ttl: Duration,
    inner: Mutex<Option<(TrackingSettings, Instant)>>,
}

impl SettingsCache {
    pub fn new(ttl: Duration) -> Self {
        Self { ttl, inner: Mutex::new(None) }
    }

    /// Last known settings without a network call.
    pub fn peek(&self) -> Option<TrackingSettings> {
        self.inner.lock().ok()?.as_ref().map(|(s, _)| s.clone())
    }

    pub fn clear(&self) {
        if let Ok(mut g) = self.inner.lock() {
            *g = None;
        }
    }

    /// Cached settings, refreshed when older than the TTL. Falls back to the last known (or default) values.
    pub async fn get(&self, api: &Api) -> TrackingSettings {
        let cached = self.inner.lock().ok().and_then(|g| g.clone());
        if let Some((s, at)) = &cached
            && at.elapsed() < self.ttl
        {
            return s.clone();
        }
        match self.refresh(api).await {
            Ok(s) => s,
            Err(e) => {
                log::warn!("employee settings unavailable: {e}");
                cached.map(|(s, _)| s).unwrap_or_default()
            }
        }
    }

    pub async fn refresh(&self, api: &Api) -> crate::error::AppResult<TrackingSettings> {
        let v = api.employee_me().await?;
        let s = parse_settings(&v);
        if let Ok(mut g) = self.inner.lock() {
            *g = Some((s.clone(), Instant::now()));
        }
        Ok(s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn idle_note_setting_parsing() {
        assert_eq!(parse_idle_note(Some("Disabled")), IdleNoteMode::Off);
        assert_eq!(parse_idle_note(Some("DISABLED")), IdleNoteMode::Off);
        assert_eq!(parse_idle_note(Some("Enable But Not Mandatory")), IdleNoteMode::Optional);
        assert_eq!(parse_idle_note(Some("enabled but not mandatory")), IdleNoteMode::Optional);
        assert_eq!(parse_idle_note(Some("Enabled & Mandatory")), IdleNoteMode::Mandatory);
        assert_eq!(parse_idle_note(Some("MANDATORY")), IdleNoteMode::Mandatory);
        assert_eq!(parse_idle_note(Some("")), IdleNoteMode::Off);
        assert_eq!(parse_idle_note(None), IdleNoteMode::Off);
        assert_eq!(parse_idle_note(Some("something else")), IdleNoteMode::Off);
    }

    #[test]
    fn screenshot_interval_parsing() {
        assert_eq!(parse_screenshot_interval(Some("5min.")).as_secs(), 300);
        assert_eq!(parse_screenshot_interval(Some("10min.")).as_secs(), 600);
        assert_eq!(parse_screenshot_interval(Some("15min.")).as_secs(), 900);
        assert_eq!(parse_screenshot_interval(Some("garbage")).as_secs(), 600);
        assert_eq!(parse_screenshot_interval(None).as_secs(), 600);
    }

    #[test]
    fn track_apps_parsing() {
        assert_eq!(parse_track_apps(Some("OFF")), TrackApps::Off);
        assert_eq!(parse_track_apps(Some("Track Apps only")), TrackApps::AppsOnly);
        assert_eq!(parse_track_apps(Some("Track URLs only")), TrackApps::UrlsOnly);
        assert_eq!(parse_track_apps(Some("Track Apps & URLs both")), TrackApps::Both);
        assert_eq!(parse_track_apps(None), TrackApps::Both);
    }

    #[test]
    fn full_settings() {
        let s = parse_settings(&json!({
            "id": "abc", "screenshotTimer": "5min.", "screenshotBlur": "On", "screenshotNotifications": "Disable",
            "trackAppsUrls": "Track Apps only", "idleNotesSetting": "Enabled & Mandatory", "trackingScenario": "Silent"
        }));
        assert_eq!(s.employee_id.as_deref(), Some("abc"));
        assert!(s.blur);
        assert!(!s.screenshot_notifications);
        assert_eq!(s.mode, TrackingMode::Silent);
        assert_eq!(s.idle_note, IdleNoteMode::Mandatory);
        let d = parse_settings(&json!({}));
        assert_eq!(d.mode, TrackingMode::Visible);
        assert!(d.screenshot_notifications);
        assert!(!d.blur);
    }
}
