//! System idle time (seconds since the last keyboard/mouse input, system-wide).
//!
//! Windows: `GetLastInputInfo`. Linux: GNOME Mutter IdleMonitor (D-Bus) or the X11 XScreenSaver extension
//! (see `tracker::linux`). macOS: `CGEventSourceSecondsSinceLastEventType`. No hooks, no keylogging.

/// Seconds since the last user input, or `None` if the OS call fails.
pub fn system_idle_secs() -> Option<u64> {
    imp::idle_secs()
}

/// Activity samples: one every 10 s; a sample is "active" when input happened since the previous one.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct ActivitySampler {
    pub samples: u32,
    pub active: u32,
}

impl ActivitySampler {
    pub fn record(&mut self, idle_secs: u64, sample_period_secs: u64) {
        self.samples += 1;
        if idle_secs < sample_period_secs {
            self.active += 1;
        }
    }

    /// Share of active samples (0–100). With no samples yet, 0.
    pub fn percent(&self) -> u8 {
        if self.samples == 0 {
            0
        } else {
            ((self.active as f64 / self.samples as f64) * 100.0).round().min(100.0) as u8
        }
    }

    pub fn reset(&mut self) {
        *self = Self::default();
    }
}

#[cfg(target_os = "windows")]
mod imp {
    use windows_sys::Win32::System::SystemInformation::GetTickCount;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

    pub fn idle_secs() -> Option<u64> {
        let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
        // SAFETY: `info` is a properly sized LASTINPUTINFO owned by this frame.
        let ok = unsafe { GetLastInputInfo(&mut info) };
        if ok == 0 {
            return None;
        }
        // SAFETY: no arguments; both values are 32-bit tick counts, so wrapping_sub handles the 49-day wrap.
        let now = unsafe { GetTickCount() };
        Some(u64::from(now.wrapping_sub(info.dwTime)) / 1000)
    }
}

#[cfg(target_os = "macos")]
mod imp {
    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(source_state: i32, event_type: u32) -> f64;
    }
    const COMBINED_SESSION_STATE: i32 = 0;
    const ANY_INPUT_EVENT: u32 = u32::MAX;

    pub fn idle_secs() -> Option<u64> {
        // SAFETY: pure query with constant arguments.
        let s = unsafe { CGEventSourceSecondsSinceLastEventType(COMBINED_SESSION_STATE, ANY_INPUT_EVENT) };
        if s.is_finite() && s >= 0.0 { Some(s as u64) } else { None }
    }
}

#[cfg(target_os = "linux")]
mod imp {
    pub fn idle_secs() -> Option<u64> {
        crate::tracker::linux::idle_secs(crate::config::is_wayland())
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
mod imp {
    pub fn idle_secs() -> Option<u64> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn activity_percent_is_share_of_active_samples() {
        let mut s = ActivitySampler::default();
        assert_eq!(s.percent(), 0);
        s.record(2, 10);
        s.record(15, 10);
        s.record(0, 10);
        s.record(300, 10);
        assert_eq!(s.percent(), 50);
        s.reset();
        s.record(1, 10);
        assert_eq!(s.percent(), 100);
    }

    #[test]
    fn idle_query_does_not_panic() {
        let _ = system_idle_secs();
    }
}
