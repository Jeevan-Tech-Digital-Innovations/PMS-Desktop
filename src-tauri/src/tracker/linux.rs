//! Linux desktop queries. Best effort: every failure means "unknown", never a panic or a log line per call.
//!
//! - Idle time: GNOME Mutter `org.gnome.Mutter.IdleMonitor.GetIdletime` on the session bus (Wayland and X11), and
//!   the X11 XScreenSaver extension. On Wayland only Mutter is asked: XWayland sees input to X11 windows only.
//! - Screen lock: `org.gnome.ScreenSaver.GetActive` on the session bus, else systemd-logind `LockedHint` of our
//!   session on the system bus.
//!
//! - Screenshots: the whole X11 root window (every monitor, as arranged) via `GetImage`. X11 only; on Wayland
//!   capture fails and the caller logs it once (Ubuntu users run "Ubuntu on Xorg").
//!
//! Connections are opened lazily, kept, and re-opened at most every [`RECONNECT_AFTER`] after a failure (the
//! tick asks for idle time every second).

use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use dbus::blocking::Connection;
use dbus::blocking::stdintf::org_freedesktop_dbus::Properties;
use x11rb::connection::Connection as _;
use x11rb::protocol::screensaver::ConnectionExt as _;
use x11rb::rust_connection::RustConnection;

const DBUS_TIMEOUT: Duration = Duration::from_millis(500);
const RECONNECT_AFTER: Duration = Duration::from_secs(30);

struct Lazy<T> {
    conn: Option<T>,
    failed_at: Option<Instant>,
}

impl<T> Lazy<T> {
    const fn new() -> Self {
        Self { conn: None, failed_at: None }
    }

    fn get(&mut self, connect: impl FnOnce() -> Option<T>) -> Option<&T> {
        if self.conn.is_none() {
            if self.failed_at.is_some_and(|t| t.elapsed() < RECONNECT_AFTER) {
                return None;
            }
            self.conn = connect();
            self.failed_at = if self.conn.is_none() { Some(Instant::now()) } else { None };
        }
        self.conn.as_ref()
    }

    fn reset(&mut self) {
        self.conn = None;
        self.failed_at = Some(Instant::now());
    }
}

static SESSION_BUS: Mutex<Lazy<Connection>> = Mutex::new(Lazy::new());
static SYSTEM_BUS: Mutex<Lazy<Connection>> = Mutex::new(Lazy::new());
static X11: Mutex<Lazy<(RustConnection, u32)>> = Mutex::new(Lazy::new());

fn locked<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

#[derive(Clone, Copy)]
enum Bus {
    Session,
    System,
}

fn bus_call<R>(bus: Bus, f: impl FnOnce(&Connection) -> Result<R, dbus::Error>) -> Option<R> {
    let mut lazy = locked(match bus {
        Bus::Session => &SESSION_BUS,
        Bus::System => &SYSTEM_BUS,
    });
    let conn = lazy.get(|| match bus {
        Bus::Session => Connection::new_session().ok(),
        Bus::System => Connection::new_system().ok(),
    })?;
    match f(conn) {
        Ok(r) => Some(r),
        Err(_) => {
            // A missing service (not GNOME, no logind) is an answer; only a dead bus needs a new connection.
            if !conn.channel().is_connected() {
                lazy.reset();
            }
            None
        }
    }
}

/// Milliseconds since the last input, from GNOME Mutter.
fn mutter_idle_ms() -> Option<u64> {
    bus_call(Bus::Session, |c| {
        let p = c.with_proxy("org.gnome.Mutter.IdleMonitor", "/org/gnome/Mutter/IdleMonitor/Core", DBUS_TIMEOUT);
        let (ms,): (u64,) = p.method_call("org.gnome.Mutter.IdleMonitor", "GetIdletime", ())?;
        Ok(ms)
    })
}

/// Milliseconds since the last input, from the X server (XScreenSaver extension).
fn x11_idle_ms() -> Option<u64> {
    let mut lazy = locked(&X11);
    let (conn, root) = lazy.get(|| {
        let (conn, screen) = x11rb::connect(None).ok()?;
        let root = conn.setup().roots.get(screen)?.root;
        Some((conn, root))
    })?;
    let reply = conn.screensaver_query_info(*root).ok().and_then(|cookie| cookie.reply().ok());
    match reply {
        Some(r) => Some(u64::from(r.ms_since_user_input)),
        None => {
            lazy.reset();
            None
        }
    }
}

/// Seconds since the last user input. `wayland`: the session is Wayland (see `config::linux_session`).
pub fn idle_secs(wayland: bool) -> Option<u64> {
    let ms = if wayland { mutter_idle_ms() } else { x11_idle_ms().or_else(mutter_idle_ms) };
    ms.map(|ms| ms / 1000)
}

/// `Some(true)` while the screen is locked, `None` when neither GNOME nor logind answers.
pub fn screen_locked() -> Option<bool> {
    let gnome = bus_call(Bus::Session, |c| {
        let p = c.with_proxy("org.gnome.ScreenSaver", "/org/gnome/ScreenSaver", DBUS_TIMEOUT);
        let (active,): (bool,) = p.method_call("org.gnome.ScreenSaver", "GetActive", ())?;
        Ok(active)
    });
    gnome.or_else(|| {
        bus_call(Bus::System, |c| {
            // "auto": the caller's session, or the user's display session.
            let p = c.with_proxy("org.freedesktop.login1", "/org/freedesktop/login1/session/auto", DBUS_TIMEOUT);
            p.get::<bool>("org.freedesktop.login1.Session", "LockedHint")
        })
    })
}

/// Capture the whole X11 root window as RGBA, in strips so no single reply gets huge. Blocking.
pub fn capture_root() -> Result<image::RgbaImage, String> {
    use x11rb::protocol::xproto::{ConnectionExt as _, ImageFormat, ImageOrder};
    const STRIP: u16 = 256;

    let (conn, screen_num) = x11rb::connect(None).map_err(|e| format!("X11 connect failed: {e}"))?;
    let setup = conn.setup();
    let screen = setup.roots.get(screen_num).ok_or("no X11 screen")?;
    let (w, h) = (screen.width_in_pixels, screen.height_in_pixels);
    let bpp = setup.pixmap_formats.iter().find(|f| f.depth == screen.root_depth).map_or(0, |f| f.bits_per_pixel);
    if bpp != 32 || w == 0 || h == 0 {
        return Err(format!("unsupported X11 screen: depth {}, {bpp} bits per pixel, {w}x{h}", screen.root_depth));
    }
    let lsb = setup.image_byte_order == ImageOrder::LSB_FIRST;
    let stride = usize::from(w) * 4;
    let mut out = image::RgbaImage::new(u32::from(w), u32::from(h));
    let mut y: u16 = 0;
    while y < h {
        let rows = STRIP.min(h - y);
        let top = i16::try_from(y).map_err(|_| "X11 screen too tall")?;
        let reply = conn
            .get_image(ImageFormat::Z_PIXMAP, screen.root, 0, top, w, rows, u32::MAX)
            .map_err(|e| e.to_string())?
            .reply()
            .map_err(|e| e.to_string())?;
        if reply.data.len() < stride * usize::from(rows) {
            return Err("short X11 image reply".to_string());
        }
        for (r, row) in reply.data.chunks_exact(stride).take(usize::from(rows)).enumerate() {
            for (x, p) in row.as_chunks::<4>().0.iter().enumerate() {
                // 32 bpp TrueColor: B,G,R,X in LSB-first order, X,R,G,B in MSB-first order.
                let rgb = if lsb { [p[2], p[1], p[0]] } else { [p[1], p[2], p[3]] };
                out.put_pixel(x as u32, u32::from(y) + r as u32, image::Rgba([rgb[0], rgb[1], rgb[2], 255]));
            }
        }
        y += rows;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lazy_waits_before_reconnecting() {
        let mut l: Lazy<u8> = Lazy::new();
        assert!(l.get(|| None).is_none());
        // Within the back-off window the connector is not called again.
        assert!(l.get(|| panic!("reconnected too early")).is_none());
        l.failed_at = Some(Instant::now() - RECONNECT_AFTER);
        assert_eq!(l.get(|| Some(7)), Some(&7));
        assert_eq!(l.get(|| panic!("already connected")), Some(&7));
        l.reset();
        assert!(l.get(|| panic!("reconnected too early")).is_none());
    }

    #[test]
    fn queries_do_not_panic() {
        let _ = idle_secs(false);
        let _ = idle_secs(true);
        let _ = screen_locked();
    }
}
