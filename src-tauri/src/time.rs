//! Time formatting for PMS-API. One helper owns the wire format (docs/ARCHITECTURE.md section 3).

use chrono::{DateTime, FixedOffset, Local, NaiveDateTime, TimeZone};

/// `true`: ISO-8601 with offset (`2026-11-14T18:04:00+05:30`).
/// `false`: local wall time without offset (`2026-11-14T18:04:00`), the legacy format.
///
/// The running PMS-API (checked Nov 2026) already parses offsets for transitions (`effectiveTime`),
/// app usage (`startTime`/`endTime`) and screenshots (`capturedAt`), converting to IST. Flip this one
/// line back to `false` if a deployed API rejects offsets.
pub const SEND_OFFSET: bool = true;

/// PMS-API stores and returns IST wall-clock times without an offset.
pub const SERVER_OFFSET_SECS: i32 = 5 * 3600 + 30 * 60;

pub fn api_ts<Tz: TimeZone>(dt: &DateTime<Tz>) -> String
where
    Tz::Offset: std::fmt::Display,
{
    format_ts(dt, SEND_OFFSET)
}

pub fn format_ts<Tz: TimeZone>(dt: &DateTime<Tz>, with_offset: bool) -> String
where
    Tz::Offset: std::fmt::Display,
{
    if with_offset {
        dt.format("%Y-%m-%dT%H:%M:%S%:z").to_string()
    } else {
        dt.format("%Y-%m-%dT%H:%M:%S").to_string()
    }
}

pub fn api_now() -> String {
    api_ts(&Local::now())
}

/// Parse a timestamp from PMS-API. Strings with an offset/`Z` are taken as-is; bare
/// `YYYY-MM-DDTHH:mm:ss[.fff]` (or with a space) are IST wall time.
pub fn parse_server_ts(s: &str) -> Option<DateTime<FixedOffset>> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
        return Some(dt);
    }
    let normalized = s.replacen(' ', "T", 1);
    let naive = NaiveDateTime::parse_from_str(&normalized, "%Y-%m-%dT%H:%M:%S%.f")
        .or_else(|_| NaiveDateTime::parse_from_str(&normalized, "%Y-%m-%dT%H:%M"))
        .ok()?;
    let ist = FixedOffset::east_opt(SERVER_OFFSET_SECS)?;
    ist.from_local_datetime(&naive).single()
}

/// ISO string for the UI (`TimerSnapshot.startedAt`, `breakInfo.startedAt`): RFC 3339 with offset.
pub fn ui_iso<Tz: TimeZone>(dt: &DateTime<Tz>) -> String
where
    Tz::Offset: std::fmt::Display,
{
    dt.to_rfc3339_opts(chrono::SecondsFormat::Secs, false)
}

/// `HH:MM` for the tray status line.
pub fn hhmm(secs: u64) -> String {
    format!("{:02}:{:02}", secs / 3600, (secs % 3600) / 60)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ist() -> FixedOffset {
        FixedOffset::east_opt(SERVER_OFFSET_SECS).unwrap()
    }

    #[test]
    fn formats_with_and_without_offset() {
        let dt = ist().with_ymd_and_hms(2026, 11, 14, 18, 4, 0).unwrap();
        assert_eq!(format_ts(&dt, true), "2026-11-14T18:04:00+05:30");
        assert_eq!(format_ts(&dt, false), "2026-11-14T18:04:00");
        let utc = chrono::Utc.with_ymd_and_hms(2026, 1, 2, 3, 4, 5).unwrap();
        assert_eq!(format_ts(&utc, true), "2026-01-02T03:04:05+00:00");
    }

    #[test]
    fn api_ts_follows_switch() {
        let dt = ist().with_ymd_and_hms(2026, 11, 14, 18, 4, 0).unwrap();
        assert_eq!(api_ts(&dt).ends_with("+05:30"), SEND_OFFSET);
    }

    #[test]
    fn parses_server_times_as_ist() {
        let dt = parse_server_ts("2026-11-14T18:04:00").unwrap();
        assert_eq!(dt.offset().local_minus_utc(), SERVER_OFFSET_SECS);
        assert_eq!(dt.to_rfc3339(), "2026-11-14T18:04:00+05:30");
        assert!(parse_server_ts("2026-11-14 18:04:00.123").is_some());
        let z = parse_server_ts("2026-11-14T12:34:00Z").unwrap();
        assert_eq!(z.timestamp(), dt.timestamp());
        assert!(parse_server_ts("").is_none());
        assert!(parse_server_ts("nope").is_none());
    }

    #[test]
    fn hhmm_formats() {
        assert_eq!(hhmm(0), "00:00");
        assert_eq!(hhmm(2 * 3600 + 14 * 60 + 59), "02:14");
        assert_eq!(hhmm(30 * 3600), "30:00");
    }
}
