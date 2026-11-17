//! "Last known alive" record for the running timer (docs/ARCHITECTURE.md section 6, "Shutdown and sleep").
//!
//! While a timer runs, `{ timeLogId, taskId, lastAliveAt }` is written to `<app data>/timer-alive.json` on every
//! heartbeat (30 s) and every state change. A clean stop deletes it. If the computer lost power, the battery died
//! or the app crashed, the file survives; at the next start the poll that would otherwise re-adopt the still-open
//! log (counting the off time as work) ends it at `lastAliveAt` instead. The decision is pure and unit-tested.

use std::path::PathBuf;
use std::time::Duration;

use chrono::{DateTime, Local, Utc};
use serde::{Deserialize, Serialize};

pub const FILE_NAME: &str = "timer-alive.json";

/// A saved timer older than this at start-up means the computer was off in between (an app restart or an
/// update is back well inside two minutes).
pub const STALE_AFTER: Duration = Duration::from_secs(2 * 60);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AliveState {
    pub time_log_id: i64,
    pub task_id: i64,
    pub last_alive_at: DateTime<Utc>,
}

/// What to do with a saved record once the server's active log is known.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// The server log is the saved one and the computer was off: end it at this time and do not adopt it.
    EndAt(DateTime<Utc>),
    /// The same log, seen again within [`STALE_AFTER`]: a restart. Keep the existing adopt behaviour.
    Adopt,
    /// The server has no active log, or a different one (for example started on the web): the record is obsolete.
    Discard,
}

/// `forced`: the record was written by a stop that could not reach the server (sleep, quit while offline), so the
/// log must be ended at `lastAliveAt` whatever its age.
pub fn decide(saved: &AliveState, server_log_id: Option<i64>, now: DateTime<Utc>, forced: bool) -> Action {
    if server_log_id != Some(saved.time_log_id) {
        return Action::Discard;
    }
    let age = now.signed_duration_since(saved.last_alive_at).to_std().unwrap_or_default();
    if forced || age > STALE_AFTER { Action::EndAt(saved.last_alive_at) } else { Action::Adopt }
}

/// The end time may not precede the log's start (the server would reject it).
pub fn clamp_end<Tz: chrono::TimeZone>(end: DateTime<Local>, start: DateTime<Tz>) -> DateTime<Local> {
    if end < start { start.with_timezone(&Local) } else { end }
}

/// `3:07 PM` in local time, for "Your timer was stopped at … when this computer turned off."
pub fn clock(t: DateTime<Utc>) -> String {
    t.with_timezone(&Local).format("%-I:%M %p").to_string()
}

pub struct AliveFile {
    path: PathBuf,
}

impl AliveFile {
    pub fn new(data_dir: &std::path::Path) -> Self {
        Self { path: data_dir.join(FILE_NAME) }
    }

    pub fn load(&self) -> Option<AliveState> {
        serde_json::from_slice(&std::fs::read(&self.path).ok()?).ok()
    }

    /// Atomic (temp file + rename): a power cut mid-write must not leave a torn record.
    pub fn save(&self, s: &AliveState) {
        let write = || -> std::io::Result<()> {
            if let Some(dir) = self.path.parent() {
                std::fs::create_dir_all(dir)?;
            }
            let tmp = self.path.with_extension("json.tmp");
            std::fs::write(&tmp, serde_json::to_vec(s).map_err(std::io::Error::other)?)?;
            std::fs::rename(&tmp, &self.path)
        };
        if let Err(e) = write() {
            log::debug!("alive file: {e}");
        }
    }

    pub fn clear(&self) {
        let _ = std::fs::remove_file(&self.path);
    }

    /// Delete the record only if it belongs to this log (a newer log's record must survive).
    pub fn clear_for(&self, time_log_id: i64) {
        if self.load().is_none_or(|s| s.time_log_id == time_log_id) {
            self.clear();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn at(h: u32, m: u32, s: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 11, 17, h, m, s).unwrap()
    }

    fn saved() -> AliveState {
        AliveState { time_log_id: 7, task_id: 3, last_alive_at: at(10, 0, 0) }
    }

    #[test]
    fn same_log_after_a_long_gap_is_ended_at_last_alive() {
        assert_eq!(decide(&saved(), Some(7), at(10, 2, 1), false), Action::EndAt(at(10, 0, 0)));
        assert_eq!(decide(&saved(), Some(7), at(14, 0, 0), false), Action::EndAt(at(10, 0, 0)));
    }

    #[test]
    fn same_log_within_two_minutes_is_adopted() {
        assert_eq!(decide(&saved(), Some(7), at(10, 0, 5), false), Action::Adopt);
        assert_eq!(decide(&saved(), Some(7), at(10, 2, 0), false), Action::Adopt);
        // A clock that went backwards is not "stale".
        assert_eq!(decide(&saved(), Some(7), at(9, 59, 0), false), Action::Adopt);
    }

    #[test]
    fn forced_records_end_whatever_their_age() {
        assert_eq!(decide(&saved(), Some(7), at(10, 0, 1), true), Action::EndAt(at(10, 0, 0)));
    }

    #[test]
    fn different_or_missing_server_log_discards() {
        assert_eq!(decide(&saved(), Some(8), at(12, 0, 0), false), Action::Discard);
        assert_eq!(decide(&saved(), None, at(12, 0, 0), false), Action::Discard);
        assert_eq!(decide(&saved(), None, at(12, 0, 0), true), Action::Discard);
    }

    #[test]
    fn end_never_precedes_start() {
        let start = Local.with_ymd_and_hms(2026, 11, 17, 10, 0, 0).unwrap();
        let before = start - chrono::Duration::minutes(5);
        let after = start + chrono::Duration::minutes(5);
        assert_eq!(clamp_end(before, start), start);
        assert_eq!(clamp_end(after, start), after);
    }

    #[test]
    fn clock_is_twelve_hour() {
        let s = clock(at(10, 7, 0));
        assert!(s.ends_with("AM") || s.ends_with("PM"), "{s}");
        assert!(!s.starts_with('0'));
    }

    #[test]
    fn file_round_trip_and_scoped_clear() {
        let dir = std::env::temp_dir().join(format!("pms-alive-test-{}", uuid::Uuid::new_v4().simple()));
        let f = AliveFile::new(&dir);
        assert!(f.load().is_none());
        f.save(&saved());
        assert_eq!(f.load(), Some(saved()));
        let json = std::fs::read_to_string(dir.join(FILE_NAME)).unwrap();
        assert!(json.contains("\"timeLogId\":7") && json.contains("\"lastAliveAt\":\"2026-11-17T10:00:00Z\""), "{json}");
        f.clear_for(8);
        assert!(f.load().is_some());
        f.clear_for(7);
        assert!(f.load().is_none());
        std::fs::write(dir.join(FILE_NAME), "not json").unwrap();
        assert!(f.load().is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
