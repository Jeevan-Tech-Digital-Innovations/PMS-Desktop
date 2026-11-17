//! Ubuntu: systemd-logind integration on its own thread and its own system-bus connection (the shared lazy
//! connection in `linux.rs` is locked by the per-second idle query).
//!
//! - While a timer runs, a **delay** inhibitor (`Inhibit("shutdown:sleep", …, "delay")`) gives us up to logind's
//!   `InhibitDelayMaxSec` (5 s by default) between `PrepareForShutdown(true)` and the actual shutdown.
//! - `PrepareForShutdown(true)`: stop the timer at "now" (`Core::stop_on_exit`, one HTTP call under a 3 s budget),
//!   then drop the inhibitor so the shutdown proceeds.
//! - `PrepareForSleep(true)`: remember the exact sleep start (`power::note_sleep_started`, which refines the
//!   clock-jump detection so the stop on wake is ended at the real moment), persist the alive record, and drop the
//!   inhibitor at once so suspend is never delayed. After resume the inhibitor is taken again.
//!
//! The wake decision itself (sleep of at least `SLEEP_STOP_AFTER` → stop at the sleep start) stays in one place:
//! `Core::on_power`. Everything is best effort: no logind or no permission just means the clock-jump path and the
//! start-up guard are used.

use std::sync::Arc;
use std::sync::mpsc::{Receiver, channel};
use std::time::{Duration, SystemTime};

use dbus::arg::OwnedFd;
use dbus::blocking::Connection;
use dbus::message::MatchRule;

use crate::app::{Core, EXIT_STOP_BUDGET};
use crate::tracker::power;

const DEST: &str = "org.freedesktop.login1";
const PATH: &str = "/org/freedesktop/login1";
const MANAGER: &str = "org.freedesktop.login1.Manager";
const CALL_TIMEOUT: Duration = Duration::from_secs(2);
const POLL: Duration = Duration::from_millis(500);
const RETRY_AFTER: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Signal {
    Shutdown(bool),
    Sleep(bool),
}

/// Start the logind thread. Never fails the app.
pub fn spawn(core: Arc<Core>) {
    let r = std::thread::Builder::new().name("logind".into()).spawn(move || {
        let mut warned = false;
        loop {
            if let Err(e) = run(&core) {
                if warned {
                    log::debug!("logind: {e}");
                } else {
                    warned = true;
                    log::info!("logind integration unavailable ({e}); shutdown is covered by the start-up guard");
                }
            }
            std::thread::sleep(RETRY_AFTER);
        }
    });
    if let Err(e) = r {
        log::warn!("logind thread: {e}");
    }
}

/// `Inhibit(what, who, why, mode)` → the lock lives while the returned fd is open.
fn take_inhibitor(conn: &Connection) -> Result<OwnedFd, dbus::Error> {
    let p = conn.with_proxy(DEST, PATH, CALL_TIMEOUT);
    let (fd,): (OwnedFd,) = p.method_call(MANAGER, "Inhibit", ("shutdown:sleep", "PMS Desktop", "Stopping your timer", "delay"))?;
    Ok(fd)
}

fn subscribe(conn: &Connection) -> Result<Receiver<Signal>, dbus::Error> {
    let (tx, rx) = channel();
    let t = tx.clone();
    conn.add_match(MatchRule::new_signal(MANAGER, "PrepareForShutdown"), move |(start,): (bool,), _, _| {
        let _ = t.send(Signal::Shutdown(start));
        true
    })?;
    conn.add_match(MatchRule::new_signal(MANAGER, "PrepareForSleep"), move |(start,): (bool,), _, _| {
        let _ = tx.send(Signal::Sleep(start));
        true
    })?;
    Ok(rx)
}

fn run(core: &Arc<Core>) -> Result<(), dbus::Error> {
    let conn = Connection::new_system()?;
    let signals = subscribe(&conn)?;
    let mut inhibitor: Option<OwnedFd> = None;
    // Set from PrepareForShutdown(true): the machine is going down, do not take new inhibitors.
    let mut going_down = false;
    // Between PrepareForSleep(true) and (false): suspending, so no inhibitor either.
    let mut asleep = false;
    let mut logged_inhibit_error = false;
    loop {
        let want = core.is_running() && !going_down && !asleep;
        if want && inhibitor.is_none() {
            match take_inhibitor(&conn) {
                Ok(fd) => inhibitor = Some(fd),
                Err(e) if !logged_inhibit_error => {
                    logged_inhibit_error = true;
                    log::info!("logind inhibitor refused: {e}");
                }
                Err(_) => {}
            }
        } else if !want && inhibitor.is_some() {
            inhibitor = None;
        }

        conn.process(POLL)?;

        while let Ok(sig) = signals.try_recv() {
            match sig {
                Signal::Shutdown(true) => {
                    going_down = true;
                    log::info!("PrepareForShutdown: stopping the timer");
                    core.stop_on_exit(EXIT_STOP_BUDGET);
                    inhibitor = None;
                }
                Signal::Shutdown(false) => going_down = false,
                Signal::Sleep(true) => {
                    asleep = true;
                    power::note_sleep_started(SystemTime::now());
                    core.persist_alive_now();
                    inhibitor = None;
                }
                // The inhibitor comes back at the top of the loop if the timer is still running.
                Signal::Sleep(false) => asleep = false,
            }
        }
    }
}
