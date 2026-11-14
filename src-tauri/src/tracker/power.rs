//! Sleep / lock detection (docs/ARCHITECTURE.md section 6): a 5 s loop where a wall-clock jump of more
//! than 30 s means the machine slept; lock comes from the OS where available (Windows input desktop, Linux
//! GNOME ScreenSaver / systemd-logind over D-Bus).

use std::time::{Duration, SystemTime};

pub const SLEEP_JUMP: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PowerEvent {
    /// Woke up after sleeping for about this long.
    Woke(Duration),
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
            out.push(PowerEvent::Woke(gap));
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
}
