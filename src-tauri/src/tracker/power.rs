//! Sleep / lock detection (docs/ARCHITECTURE.md section 6): a 5 s loop where a wall-clock jump of more
//! than 30 s means the machine slept; lock comes from the OS where available (Windows input desktop, Linux
//! GNOME ScreenSaver / systemd-logind over D-Bus).

use std::sync::Mutex;
use std::time::{Duration, SystemTime};

pub const SLEEP_JUMP: Duration = Duration::from_secs(30);

/// Sleeping at least this long stops the timer on wake, ended at the moment sleep began (docs/ARCHITECTURE.md
/// section 6). Shorter sleeps only pause capture and re-check the active timer. `PMS_DEV_FAST` shortens it
/// (`config::Timings`).
pub const SLEEP_STOP_AFTER: Duration = Duration::from_secs(5 * 60);

/// Exact start of the latest sleep, when the OS told us (Linux: logind `PrepareForSleep(true)`).
static SLEEP_MARK: Mutex<Option<SystemTime>> = Mutex::new(None);

/// Record the moment the OS announced sleep. Used only to refine [`PowerWatch`]'s clock-jump detection.
pub fn note_sleep_started(at: SystemTime) {
    *SLEEP_MARK.lock().unwrap_or_else(|p| p.into_inner()) = Some(at);
}

fn take_sleep_mark() -> Option<SystemTime> {
    SLEEP_MARK.lock().unwrap_or_else(|p| p.into_inner()).take()
}

/// When sleep began: the OS-reported time if it lies between the last two checks, else the last check before the
/// clock jumped (at most one check period early). Pure.
pub fn sleep_began(prev: SystemTime, now: SystemTime, reported: Option<SystemTime>) -> SystemTime {
    reported.filter(|r| *r >= prev && *r <= now).unwrap_or(prev)
}

/// The moment to end the timer at after a sleep of `slept`, or `None` when it was short enough to keep going. Pure.
pub fn sleep_stop_at(slept: Duration, began: SystemTime, stop_after: Duration) -> Option<SystemTime> {
    (slept >= stop_after).then_some(began)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PowerEvent {
    /// Woke up after sleeping for about `gap`; sleep began at `began`.
    Woke { gap: Duration, began: SystemTime },
    Locked,
    Unlocked,
}

pub struct PowerWatch {
    last_wall: SystemTime,
    expected: Duration,
    locked: bool,
}

impl PowerWatch {
    pub fn new(period: Duration) -> Self {
        Self { last_wall: SystemTime::now(), expected: period, locked: false }
    }

    /// Pure core: given the previous and current wall clock, did we sleep?
    pub fn slept(prev: SystemTime, now: SystemTime, expected: Duration) -> Option<Duration> {
        let gap = now.duration_since(prev).unwrap_or_default();
        if gap > expected + SLEEP_JUMP { Some(gap.saturating_sub(expected)) } else { None }
    }

    pub fn check(&mut self) -> Vec<PowerEvent> {
        let mut out = Vec::new();
        let now = SystemTime::now();
        if let Some(gap) = Self::slept(self.last_wall, now, self.expected) {
            let began = sleep_began(self.last_wall, now, take_sleep_mark());
            out.push(PowerEvent::Woke { gap, began });
        }
        self.last_wall = now;
        if let Some(locked) = session_locked()
            && locked != self.locked
        {
            self.locked = locked;
            out.push(if locked { PowerEvent::Locked } else { PowerEvent::Unlocked });
        }
        out
    }

    pub fn is_locked(&self) -> bool {
        self.locked
    }
}

/// `Some(true)` when the session is locked (secure desktop active). `None` where unknown.
#[cfg(target_os = "windows")]
pub fn session_locked() -> Option<bool> {
    use windows_sys::Win32::System::StationsAndDesktops::{CloseDesktop, OpenInputDesktop};
    const DESKTOP_SWITCHDESKTOP: u32 = 0x0100;
    // SAFETY: plain Win32 call; the handle is closed below when non-null.
    let h = unsafe { OpenInputDesktop(0, 0, DESKTOP_SWITCHDESKTOP) };
    if h.is_null() {
        return Some(true);
    }
    // SAFETY: `h` is a valid desktop handle returned above.
    unsafe { CloseDesktop(h) };
    Some(false)
}

/// Linux: GNOME ScreenSaver, else logind `LockedHint`. Best effort: no answer means "not locked", so a lost
/// D-Bus connection never leaves capture paused.
#[cfg(target_os = "linux")]
pub fn session_locked() -> Option<bool> {
    Some(crate::tracker::linux::screen_locked().unwrap_or(false))
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
pub fn session_locked() -> Option<bool> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_clock_jump() {
        let t0 = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        let p = Duration::from_secs(5);
        assert_eq!(PowerWatch::slept(t0, t0 + Duration::from_secs(5), p), None);
        assert_eq!(PowerWatch::slept(t0, t0 + Duration::from_secs(30), p), None);
        assert_eq!(PowerWatch::slept(t0, t0 + Duration::from_secs(605), p), Some(Duration::from_secs(600)));
        // Clock going backwards is not sleep.
        assert_eq!(PowerWatch::slept(t0, t0 - Duration::from_secs(100), p), None);
    }

    #[test]
    fn sleep_start_prefers_the_os_time_inside_the_window() {
        let t0 = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        let now = t0 + Duration::from_secs(900);
        assert_eq!(sleep_began(t0, now, None), t0);
        let exact = t0 + Duration::from_secs(3);
        assert_eq!(sleep_began(t0, now, Some(exact)), exact);
        // A stale mark from an earlier sleep, or one from the future, is ignored.
        assert_eq!(sleep_began(t0, now, Some(t0 - Duration::from_secs(60))), t0);
        assert_eq!(sleep_began(t0, now, Some(now + Duration::from_secs(1))), t0);
    }

    #[test]
    fn long_sleep_stops_at_sleep_start_short_sleep_does_not() {
        let began = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        let five = SLEEP_STOP_AFTER;
        assert_eq!(sleep_stop_at(five - Duration::from_secs(1), began, five), None);
        assert_eq!(sleep_stop_at(five, began, five), Some(began));
        assert_eq!(sleep_stop_at(Duration::from_secs(3 * 3600), began, five), Some(began));
        // The dev-fast threshold is shorter.
        assert_eq!(sleep_stop_at(Duration::from_secs(61), began, Duration::from_secs(60)), Some(began));
    }

    #[test]
    fn mark_is_used_once() {
        let t0 = SystemTime::UNIX_EPOCH + Duration::from_secs(2_000_000);
        note_sleep_started(t0);
        assert_eq!(take_sleep_mark(), Some(t0));
        assert_eq!(take_sleep_mark(), None);
    }
}
