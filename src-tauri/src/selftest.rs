//! `cargo run -- --selftest` (debug builds only): a non-destructive end-to-end check.
//!
//! Signs in with `PMS_DEV_EMAIL` / `PMS_DEV_PASSWORD` (in-memory secret store, the real keychain is not
//! touched), switches to the SAME active company, reads projects / tasks / settings / active timer,
//! captures one screenshot to a temp file (no upload), reads the active window and system idle time,
//! then signs the self-test device out again. It never starts timers, uploads or prints secrets.
//!
//! `PMS_SELFTEST_HEADLESS=1` (CI runners without an interactive desktop): a failing screenshot, active-window
//! or idle step is reported as SKIP instead of FAIL. The API steps still have to pass.

use std::sync::Arc;
use std::time::Instant;

use crate::app::Core;
use crate::auth::MemoryStore;
use crate::config::Config;
use crate::tracker::{apps, idle, screenshot};

struct Row {
    name: &'static str,
    ok: Option<bool>,
    detail: String,
    ms: u128,
}

fn short(s: &str, n: usize) -> String {
    let s: String = s.chars().take(n).collect();
    s.replace(['\n', '\r'], " ")
}

pub fn run() -> i32 {
    let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build().expect("tokio runtime");
    rt.block_on(run_async())
}

#[allow(unused_must_use)] // `step!` returns pass/fail; most call sites only record it.
async fn run_async() -> i32 {
    let cfg = Config::load();
    println!("PMS Desktop self-test · {} · API {} · Axis {}", crate::config::user_agent(), cfg.api_url, cfg.axis_url);
    let mut rows: Vec<Row> = Vec::new();
    macro_rules! step {
        ($name:expr, $body:expr) => {{
            let t = Instant::now();
            let (ok, detail): (Option<bool>, String) = $body;
            rows.push(Row { name: $name, ok, detail, ms: t.elapsed().as_millis() });
            ok == Some(true)
        }};
    }

    let headless = std::env::var("PMS_SELFTEST_HEADLESS").is_ok_and(|v| v == "1" || v.eq_ignore_ascii_case("true"));
    // Desktop-only steps: a failure is a SKIP when headless.
    let desktop = |ok: bool| if ok { Some(true) } else if headless { None } else { Some(false) };

    let (Some(email), Some(password)) = (cfg.dev_email.clone(), cfg.dev_password.clone()) else {
        println!("FAIL: set PMS_DEV_EMAIL and PMS_DEV_PASSWORD");
        return 2;
    };
    let core: Arc<Core> = Core::new(cfg.clone(), Arc::new(MemoryStore::default()));

    let signed_in = step!("axis sign-in", match core.auth.sign_in(&email, &password).await {
        Ok(()) => {
            let id = core.auth.identity().unwrap();
            (Some(true), format!("{} company membership(s)", id.memberships.len()))
        }
        Err(e) => (Some(false), e.message),
    });

    if signed_in {
        step!("switch-tenant (same company)", {
            let active = core.auth.identity().map(|i| i.active_tenant_id).unwrap_or_default();
            match core.auth.switch_tenant(&active).await {
                Ok(()) => {
                    let after = core.auth.identity().map(|i| i.active_tenant_id).unwrap_or_default();
                    (Some(after == active), if after == active { "still on the active company".into() } else { "company changed!".into() })
                }
                Err(e) => (Some(false), e.message),
            }
        });

        step!("GET /employees/me settings", match core.settings.refresh(&core.api).await {
            Ok(s) => (
                Some(true),
                format!(
                    "mode {:?}, screenshots every {} min, blur {}, apps {:?}, idle note {:?}",
                    s.mode,
                    s.screenshot_interval.as_secs() / 60,
                    s.blur,
                    s.track_apps,
                    s.idle_note
                ),
            ),
            Err(e) => (Some(false), e.message),
        });

        let mut first_project: Option<(i64, &'static str)> = None;
        step!("GET /projects", match core.list_projects().await {
            Ok(p) => {
                first_project = p.first().map(|p| (p.id, "first assigned project"));
                (Some(true), format!("{} assigned project(s)", p.len()))
            }
            Err(e) => (Some(false), short(&e.message, 160)),
        });

        step!("recent tasks", match core.recent_tasks().await {
            Ok(r) => {
                if first_project.is_none() {
                    first_project = r.first().map(|t| (t.project_id, "project of the latest recent task"));
                }
                (Some(true), format!("{} recent task(s)", r.len()))
            }
            Err(e) => (Some(false), e.message),
        });

        if let Some((pid, which)) = first_project {
            let mut with_children = None;
            step!("GET /projects/{id}/tasks", match core.list_tasks(pid).await {
                Ok(t) => {
                    with_children = t.iter().find(|n| n.has_children).map(|n| n.id);
                    (Some(true), format!("{which}: {} visible task(s)", t.len()))
                }
                Err(e) => (Some(false), e.message),
            });
            if let Some(tid) = with_children {
                step!("GET /tasks/{id}/subtasks", match core.list_subtasks(tid).await {
                    Ok(t) => (Some(true), format!("{} sub-task(s)", t.len())),
                    Err(e) => (Some(false), e.message),
                });
            }
        } else {
            step!("GET /projects/{id}/tasks", (None, "no project known; skipped".into()));
        }

        step!("GET /tasks/time-logs/active", match core.api.active().await {
            Ok(None) => (Some(true), "no timer running (empty body handled)".into()),
            Ok(Some(l)) => (Some(true), format!("running log {} ({})", l.id.unwrap_or(0), l.time_type.unwrap_or_default())),
            Err(e) => (Some(false), e.message),
        });

        step!("today totals", {
            let (w, b) = tokio::join!(core.api.accumulated_today(), core.api.accumulated_break_today());
            match (w, b) {
                (Ok(w), Ok(b)) => (Some(true), format!("work {}, break {}", crate::time::hhmm(w), crate::time::hhmm(b))),
                (Err(e), _) | (_, Err(e)) => (Some(false), e.message),
            }
        });

        step!("GET /breaks/reasons", match core.list_break_reasons().await {
            Ok(r) => (Some(true), format!("{} reason(s)", r.len())),
            Err(e) => (Some(false), short(&e.message, 160)),
        });
    }

    step!("screenshot (temp file, not uploaded)", {
        match tokio::task::spawn_blocking(|| screenshot::capture_jpeg(false)).await {
            Ok(Ok(jpeg)) => {
                let path = std::env::temp_dir().join("pms-desktop-selftest.jpg");
                match std::fs::write(&path, &jpeg) {
                    Ok(()) => (Some(true), format!("{} KB → {}", jpeg.len() / 1024, path.display())),
                    Err(e) => (desktop(false), e.to_string()),
                }
            }
            Ok(Err(e)) => (desktop(false), short(&e, 120)),
            Err(e) => (desktop(false), e.to_string()),
        }
    });

    step!("active window", match tokio::task::spawn_blocking(apps::active_window).await.ok().flatten() {
        Some(w) => (Some(true), format!("app \"{}\" · title \"{}\"", w.app, short(&w.title, 60))),
        None => (desktop(false), "could not read the foreground window".into()),
    });

    step!("system idle", match idle::system_idle_secs() {
        Some(s) => (Some(true), format!("{s} s since last input")),
        None => (desktop(false), "unavailable".into()),
    });

    if signed_in {
        core.auth.sign_out().await;
        step!("axis logout (self-test device)", (Some(!core.auth.is_signed_in()), "refresh token revoked".into()));
    }

    println!();
    println!("{:<38} {:<6} {:>7}  detail", "step", "result", "ms");
    println!("{}", "-".repeat(100));
    let mut failed = 0;
    for r in &rows {
        let res = match r.ok {
            Some(true) => "PASS",
            Some(false) => {
                failed += 1;
                "FAIL"
            }
            None => "SKIP",
        };
        println!("{:<38} {:<6} {:>7}  {}", r.name, res, r.ms, r.detail);
    }
    println!("{}", "-".repeat(100));
    println!("{} passed, {failed} failed", rows.iter().filter(|r| r.ok == Some(true)).count());
    if failed == 0 { 0 } else { 1 }
}
