//! `cargo run -- --e2e` (debug builds only): drives the REAL core against the server with fast timings.
//!
//! Unlike `--selftest` this DOES start a timer and upload a screenshot and app usage, so only run it on
//! an account where that is authorised. It refuses to run if a timer is already running on the account,
//! always stops its own timer at the end (even after a failure) and never prints secrets.
//! The offline queue lives in a throw-away temp folder so the real app's queue is never touched.

use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::app::Core;
use crate::auth::MemoryStore;
use crate::config::{Config, Timings};
use crate::queue::Job;
use crate::types::{TimerSnapshot, TimerState};

struct Row {
    name: String,
    ok: Option<bool>,
    detail: String,
    ms: u128,
}

#[derive(Default)]
struct Report {
    rows: Vec<Row>,
    log_ids: Vec<i64>,
}

type Step = Result<String, String>;

impl Report {
    fn add(&mut self, name: &str, started: Instant, res: Step) -> bool {
        let ok = res.is_ok();
        let detail = match res {
            Ok(d) | Err(d) => d,
        };
        self.rows.push(Row { name: name.into(), ok: Some(ok), detail, ms: started.elapsed().as_millis() });
        ok
    }

    fn skip(&mut self, name: &str, why: &str) {
        self.rows.push(Row { name: name.into(), ok: None, detail: why.into(), ms: 0 });
    }

    fn saw(&mut self, snap: &TimerSnapshot) -> String {
        if let Some(id) = snap.time_log_id
            && !self.log_ids.contains(&id)
        {
            self.log_ids.push(id);
        }
        format!("state {:?}, log {}", snap.state, snap.time_log_id.map(|i| i.to_string()).unwrap_or_else(|| "-".into()))
    }
}

fn expect_state(snap: &TimerSnapshot, want: TimerState) -> Result<(), String> {
    if snap.state == want { Ok(()) } else { Err(format!("expected {want:?}, got {:?}", snap.state)) }
}

async fn server_time_type(core: &Core) -> Result<String, String> {
    match core.api.active().await {
        Ok(Some(l)) => Ok(l.time_type.unwrap_or_default()),
        Ok(None) => Err("server reports no active timer".into()),
        Err(e) => Err(e.message),
    }
}

pub fn run() -> i32 {
    let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build().expect("tokio runtime");
    rt.block_on(run_async())
}

async fn run_async() -> i32 {
    let mut cfg = Config::load();
    cfg.fast = true;
    cfg.timings = Timings::fast();
    cfg.data_dir = std::env::temp_dir().join(format!("pms-desktop-e2e-{}", uuid::Uuid::new_v4().simple()));
    println!("PMS Desktop end-to-end · {} · API {} · fast timings", crate::config::user_agent(), cfg.api_url);
    let (Some(email), Some(password)) = (cfg.dev_email.clone(), cfg.dev_password.clone()) else {
        println!("FAIL: set PMS_DEV_EMAIL and PMS_DEV_PASSWORD");
        return 2;
    };
    let data_dir = cfg.data_dir.clone();
    let core: Arc<Core> = Core::new(cfg, Arc::new(MemoryStore::default()));
    let mut r = Report::default();

    let t = Instant::now();
    let signed_in = r.add(
        "sign_in",
        t,
        core.sign_in(&email, &password).await.map(|s| format!("{} company(ies), mode {:?}", s.companies.len(), s.tracking_mode)).map_err(|e| e.message),
    );

    if signed_in {
        let t = Instant::now();
        let free = r.add(
            "preflight: no timer on the account",
            t,
            match core.api.active().await {
                Ok(None) => Ok("none running".into()),
                Ok(Some(l)) => Err(format!("log {} already running; not touching it", l.id.unwrap_or(0))),
                Err(e) => Err(e.message),
            },
        );
        if free && let Err(step) = flow(&core, &mut r).await {
            println!("(flow stopped at: {step})");
        }

        // Always leave the account with no running timer we started.
        if core.is_running() {
            let t = Instant::now();
            let res = core.stop_timer_inner(true).await.map(|s| r.saw(&s)).map_err(|e| e.message);
            r.add("cleanup: stop_timer", t, res);
        }
        if free {
            let t = Instant::now();
            r.add(
                "GET /tasks/time-logs/active is empty",
                t,
                match core.api.active().await {
                    Ok(None) => Ok("no active timer".into()),
                    Ok(Some(l)) => Err(format!("log {} still active", l.id.unwrap_or(0))),
                    Err(e) => Err(e.message),
                },
            );
        }
        core.auth.sign_out().await;
    }
    let _ = std::fs::remove_dir_all(&data_dir);

    println!();
    println!("{:<40} {:<6} {:>7}  detail", "step", "result", "ms");
    println!("{}", "-".repeat(110));
    let mut failed = 0;
    for row in &r.rows {
        let res = match row.ok {
            Some(true) => "PASS",
            Some(false) => {
                failed += 1;
                "FAIL"
            }
            None => "SKIP",
        };
        println!("{:<40} {:<6} {:>7}  {}", row.name, res, row.ms, row.detail);
    }
    println!("{}", "-".repeat(110));
    println!("timeLogIds created: {:?}", r.log_ids);
    println!("{} passed, {failed} failed", r.rows.iter().filter(|x| x.ok == Some(true)).count());
    if failed == 0 { 0 } else { 1 }
}

/// The timer flow. Returns the name of the first failed step (later steps depend on earlier ones).
async fn flow(core: &Arc<Core>, r: &mut Report) -> Result<(), String> {
    let pace = Duration::from_secs(2);
    macro_rules! step {
        ($name:expr, $body:expr) => {{
            let t = Instant::now();
            let res: Step = $body;
            if !r.add($name, t, res) {
                return Err($name.to_string());
            }
        }};
    }

    // Task: the most recent one.
    let mut task = None;
    step!("recent_tasks → pick latest", match core.recent_tasks().await {
        Ok(list) => match list.into_iter().next() {
            Some(tk) => {
                let d = format!("task {} (project {})", tk.task_id, tk.project_id);
                task = Some(tk);
                Ok(d)
            }
            None => Err("no recent tasks on this account".into()),
        },
        Err(e) => Err(e.message),
    });
    let task = task.ok_or("no task")?;

    step!("start_timer", match core.start_timer(task).await {
        Ok(s) => expect_state(&s, TimerState::Working).map(|_| r.saw(&s)),
        Err(e) => Err(e.message),
    });

    // Two heartbeats at the real cadence.
    let hb = core.cfg.timings.heartbeat;
    step!("heartbeat #1", core.heartbeat_once().await.map(|_| "ok".into()).map_err(|e| e.message));
    tokio::time::sleep(hb).await;
    step!("heartbeat #2 (after 30 s)", core.heartbeat_once().await.map(|_| "ok".into()).map_err(|e| e.message));

    // Screenshot through the real capture path, uploaded now instead of via the queue.
    let blur = core.settings.get(&core.api).await.blur;
    step!("screenshot capture + upload", match core.capture_job().await {
        Ok(Some((Job::Screenshot { time_log_id, captured_at, activity_percent, active_window_title }, jpeg, _))) => {
            let kb = jpeg.len() / 1024;
            match core.api.upload_screenshot(time_log_id, jpeg, &captured_at, activity_percent, &active_window_title).await {
                Ok(id) => Ok(format!(
                    "screenshotId {}, log {time_log_id}, {kb} KB, blur {blur}, activity {activity_percent}%",
                    id.map(|i| i.to_string()).unwrap_or_else(|| "?".into())
                )),
                Err(e) => Err(e.message),
            }
        }
        Ok(Some(_)) => Err("unexpected job".into()),
        Ok(None) => Err("not working".into()),
        Err(e) => Err(format!("{e} (macOS: grant Screen Recording to the terminal)")),
    });

    // App usage: real window reads, then a forced flush.
    core.observe_window().await;
    tokio::time::sleep(Duration::from_secs(3)).await;
    core.observe_window().await;
    tokio::time::sleep(pace).await;
    match core.drain_usage_payload() {
        Some((items, n)) => step!("app activity flush", match core.api.app_usage(&items).await {
            Ok(accepted) => {
                if accepted == n || accepted == 0 {
                    Ok(format!("{n} row(s) sent, {accepted} accepted (first: {})", items[0]["appName"]))
                } else {
                    Err(format!("{n} sent but {accepted} accepted"))
                }
            }
            Err(e) => Err(e.message),
        }),
        None => r.skip("app activity flush", "tracking OFF for this employee or no window read"),
    }

    tokio::time::sleep(pace).await;
    step!("pause_timer", match core.pause_timer().await {
        Ok(s) => expect_state(&s, TimerState::Paused).map(|_| r.saw(&s)),
        Err(e) => Err(e.message),
    });
    tokio::time::sleep(pace).await;
    step!("resume_timer", match core.resume_timer().await {
        Ok(s) => expect_state(&s, TimerState::Working).map(|_| r.saw(&s)),
        Err(e) => Err(e.message),
    });

    let mut reason = None;
    step!("list_break_reasons", match core.list_break_reasons().await {
        Ok(list) => match list.into_iter().next() {
            Some(b) => {
                let d = format!("first: {} (limit {:?} min)", b.reason_text, b.duration_limit_minutes);
                reason = Some(b);
                Ok(d)
            }
            None => Err("no break reasons".into()),
        },
        Err(e) => Err(e.message),
    });
    let reason = reason.ok_or("no reason")?;
    tokio::time::sleep(pace).await;
    step!("start_break", match core.start_break(&reason.id).await {
        Ok(s) => expect_state(&s, TimerState::Break).map(|_| {
            let limit = s.break_info.as_ref().and_then(|b| b.limit_seconds);
            format!("{}, limit {:?} s", r.saw(&s), limit)
        }),
        Err(e) => Err(e.message),
    });
    tokio::time::sleep(pace).await;
    step!("end_break", match core.end_break().await {
        Ok(s) => expect_state(&s, TimerState::Working).map(|_| r.saw(&s)),
        Err(e) => Err(e.message),
    });

    // Idle through the real idle path (fast: 30 s threshold), then the automatic resume.
    tokio::time::sleep(pace).await;
    let idle_secs = core.cfg.timings.idle_after.as_secs();
    core.go_idle(idle_secs).await;
    let snap = core.snapshot();
    step!("idle → IDLE transition", match expect_state(&snap, TimerState::Idle) {
        Ok(()) => match server_time_type(core).await {
            Ok(tt) if tt.eq_ignore_ascii_case("IDLE") => Ok(format!("{}, server IDLE ({idle_secs} s threshold)", r.saw(&snap))),
            Ok(tt) => Err(format!("server timeType {tt}")),
            Err(e) => Err(e),
        },
        Err(e) => Err(e),
    });
    tokio::time::sleep(pace).await;
    core.auto_resume().await;
    let snap = core.snapshot();
    step!("input back → auto-resume", match expect_state(&snap, TimerState::Working) {
        Ok(()) => match server_time_type(core).await {
            Ok(tt) if tt.eq_ignore_ascii_case("ACTIVE_PRODUCTIVE") || tt.eq_ignore_ascii_case("OVERTIME") => {
                Ok(format!("{}, server {tt}", r.saw(&snap)))
            }
            Ok(tt) => Err(format!("server timeType {tt}")),
            Err(e) => Err(e),
        },
        Err(e) => Err(e),
    });

    // Offline: one app-usage upload while the API is unreachable lands in the queue, then drains.
    let real_base = core.api.base();
    core.observe_window().await;
    tokio::time::sleep(pace).await;
    let payload = core.drain_usage_payload();
    match payload {
        Some((items, n)) => {
            core.api.set_base("http://127.0.0.1:9/api/v1");
            let t = Instant::now();
            let queued = core.queue.enqueue(Job::AppUsage { items }, None).map_err(|e| e.to_string());
            let (sent, left) = core.queue.drain_once(&core.api).await;
            let offline_ok = queued.is_ok() && sent == 0 && left >= 1 && !core.api.is_online();
            core.api.set_base(&real_base);
            r.add(
                "offline: upload queued",
                t,
                if offline_ok {
                    Ok(format!("{n} row(s) kept in queue ({left} queued, online={})", core.api.is_online()))
                } else {
                    Err(format!("queued={queued:?} sent={sent} left={left}"))
                },
            );
            let (sent, left) = core.queue.drain_once(&core.api).await;
            step!(
                "online again: queue drains",
                if left == 0 && sent >= 1 { Ok(format!("{sent} item(s) sent, queue empty")) } else { Err(format!("sent {sent}, {left} left")) }
            );
        }
        None => r.skip("offline: upload queued", "no app-usage rows (tracking OFF)"),
    }

    tokio::time::sleep(pace).await;
    step!("stop_timer", match core.stop_timer().await {
        Ok(s) => expect_state(&s, TimerState::Stopped).map(|_| r.saw(&s)),
        Err(e) => Err(e.message),
    });
    Ok(())
}
