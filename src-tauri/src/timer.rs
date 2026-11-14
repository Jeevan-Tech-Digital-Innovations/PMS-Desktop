//! Timer state machine (pure, unit-tested). The async orchestration that talks to the API lives in
//! `app.rs`; this module only decides which transitions are legal and how time accrues.
//!
//! Time accrual mirrors PMS-API's accounting so the 30 s server re-sync never makes the clock jump:
//! work accrues in `working` and `paused` (server `PRODUCTIVE_PAUSE` counts as productive), break time
//! accrues in `break`, nothing accrues in `away` / `idle` / `stopped`.

use std::time::Instant;

use chrono::{DateTime, FixedOffset, Local, NaiveDate};

use crate::api::ServerState;
use crate::error::{AppError, AppResult};
use crate::time;
use crate::types::{BreakInfoDto, TaskRef, TimerSnapshot, TimerState};

#[derive(Debug, Clone, PartialEq)]
pub struct ActiveLog {
    pub id: i64,
    pub task: TaskRef,
    pub started_at: DateTime<FixedOffset>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Totals {
    /// Current task, today.
    pub task: u64,
    pub work: u64,
    pub brk: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BreakState {
    pub reason_text: String,
    pub limit_secs: Option<u64>,
    pub started_at: DateTime<Local>,
    pub started: Instant,
    pub warned: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Pause,
    Resume,
    Away,
    BreakStart,
    BreakEnd,
    /// Went idle; `subtract` seconds of already-counted work are taken back (the idle threshold).
    IdleStart { subtract: u64 },
    IdleEnd,
    Stop,
}

/// Fallback break limits by reason name (minutes).
pub fn fallback_break_limit(reason: &str) -> Option<u32> {
    let r = reason.to_lowercase();
    if ["tea", "coffee", "snack"].iter().any(|k| r.contains(k)) {
        Some(15)
    } else if ["lunch", "dinner", "meal"].iter().any(|k| r.contains(k)) {
        Some(30)
    } else {
        None
    }
}

/// Server `timeType` → local state (+ overtime flag).
pub fn state_from_server(time_type: Option<&str>) -> (TimerState, bool) {
    match time_type.unwrap_or("").trim().to_uppercase().as_str() {
        "PRODUCTIVE_PAUSE" => (TimerState::Paused, false),
        "AWAY" | "BREAK" => (TimerState::Away, false),
        "IDLE" => (TimerState::Idle, false),
        "OVERTIME" => (TimerState::Working, true),
        _ => (TimerState::Working, false),
    }
}

pub fn accrues_work(s: TimerState) -> bool {
    matches!(s, TimerState::Working | TimerState::Paused)
}

#[derive(Debug, Clone)]
pub struct TimerModel {
    pub state: TimerState,
    pub overtime: bool,
    pub overtime_prompted: bool,
    /// Day on which the employee chose to continue as overtime (new logs that day start as overtime).
    pub overtime_accepted_on: Option<NaiveDate>,
    pub log: Option<ActiveLog>,
    pub break_info: Option<BreakState>,
    /// Log the idle note belongs to (the IDLE log), kept until a new idle period or stop.
    pub idle_note_log: Option<i64>,
    /// When the timer was started locally (15 s grace against a stale "no timer" poll).
    pub local_start: Option<Instant>,
    base: Totals,
    base_at: Instant,
}

impl Default for TimerModel {
    fn default() -> Self {
        Self::new(Instant::now())
    }
}

impl TimerModel {
    pub fn new(now: Instant) -> Self {
        Self {
            state: TimerState::Stopped,
            overtime: false,
            overtime_prompted: false,
            overtime_accepted_on: None,
            log: None,
            break_info: None,
            idle_note_log: None,
            local_start: None,
            base: Totals::default(),
            base_at: now,
        }
    }

    pub fn is_running(&self) -> bool {
        self.state != TimerState::Stopped
    }

    pub fn totals(&self, now: Instant) -> Totals {
        let d = now.saturating_duration_since(self.base_at).as_secs();
        let mut t = self.base;
        if accrues_work(self.state) {
            t.task += d;
            t.work += d;
        } else if self.state == TimerState::Break {
            t.brk += d;
        }
        t
    }

    fn rebase(&mut self, now: Instant) {
        self.base = self.totals(now);
        self.base_at = now;
    }

    /// Replace the baseline with authoritative server totals measured at `now`.
    pub fn sync_totals(&mut self, t: Totals, now: Instant) {
        self.base = t;
        self.base_at = now;
    }

    /// Server server state to send when (re)entering `working`.
    pub fn working_server_state(&self) -> ServerState {
        if self.overtime { ServerState::Overtime } else { ServerState::ActiveProductive }
    }

    pub fn check(&self, action: Action) -> AppResult<()> {
        use TimerState::*;
        let ok = match action {
            Action::Pause => self.state == Working,
            Action::Resume => matches!(self.state, Paused | Away | Idle),
            Action::Away => self.state == Working,
            Action::BreakStart => self.state == Working,
            Action::BreakEnd => self.state == Break,
            Action::IdleStart { .. } => self.state == Working,
            Action::IdleEnd => self.state == Idle,
            Action::Stop => self.state != Stopped,
        };
        if ok {
            Ok(())
        } else if self.state == Stopped {
            Err(AppError::validation("No timer is running."))
        } else {
            Err(AppError::validation(format!("Can't do that while {}.", state_word(self.state))))
        }
    }

    /// Begin tracking `log` with server totals measured now.
    pub fn start(&mut self, log: ActiveLog, state: TimerState, totals: Totals, now: Instant, local: bool) {
        self.state = state;
        self.log = Some(log);
        self.break_info = None;
        self.idle_note_log = None;
        self.overtime_prompted = false;
        self.local_start = if local { Some(now) } else { None };
        self.sync_totals(totals, now);
    }

    pub fn apply(&mut self, action: Action, now: Instant) -> AppResult<()> {
        self.check(action)?;
        self.rebase(now);
        use TimerState::*;
        self.state = match action {
            Action::Pause => Paused,
            Action::Resume | Action::IdleEnd => Working,
            Action::Away => Away,
            Action::BreakStart => Break,
            Action::BreakEnd => Working,
            Action::IdleStart { subtract } => {
                self.base.task = self.base.task.saturating_sub(subtract);
                self.base.work = self.base.work.saturating_sub(subtract);
                Idle
            }
            Action::Stop => Stopped,
        };
        if !matches!(self.state, Break) {
            self.break_info = None;
        }
        if action == Action::Stop {
            self.log = None;
            self.overtime = false;
            self.overtime_prompted = false;
            self.idle_note_log = None;
            self.local_start = None;
            let t = self.base;
            self.base = Totals { task: 0, ..t };
        }
        Ok(())
    }

    /// The server now has a different open log (transition, or a change made elsewhere).
    pub fn set_log(&mut self, id: i64, started_at: Option<DateTime<FixedOffset>>) {
        if let Some(l) = self.log.as_mut() {
            l.id = id;
            if let Some(s) = started_at {
                l.started_at = s;
            }
        }
    }

    /// Adopt a state reported by the server (web app changed it) without calling the API.
    pub fn adopt_state(&mut self, state: TimerState, overtime: bool, now: Instant) {
        self.rebase(now);
        // A break shows up as AWAY on the server; keep our richer local state.
        if !(self.state == TimerState::Break && state == TimerState::Away) {
            self.state = state;
        }
        if overtime {
            self.overtime = true;
        }
        if self.state != TimerState::Break {
            self.break_info = None;
        }
    }

    /// Overtime prompt due: 8 h of work today reached while working.
    pub fn overtime_due(&self, now: Instant, threshold_secs: u64) -> bool {
        !self.overtime && !self.overtime_prompted && self.state == TimerState::Working && self.totals(now).work >= threshold_secs
    }

    /// Break went past its limit and we haven't warned yet.
    pub fn break_over_limit(&self, now: Instant) -> bool {
        match (&self.break_info, self.state) {
            (Some(b), TimerState::Break) => {
                !b.warned && b.limit_secs.is_some_and(|l| now.saturating_duration_since(b.started).as_secs() >= l)
            }
            _ => false,
        }
    }

    pub fn in_grace(&self, now: Instant, grace_secs: u64) -> bool {
        self.local_start.is_some_and(|s| now.saturating_duration_since(s).as_secs() < grace_secs)
    }

    pub fn snapshot(&self, now: Instant, queued: usize, online: bool) -> TimerSnapshot {
        let t = self.totals(now);
        TimerSnapshot {
            state: self.state,
            time_log_id: self.log.as_ref().map(|l| l.id),
            task: self.log.as_ref().map(|l| l.task.clone()),
            started_at: self.log.as_ref().map(|l| time::ui_iso(&l.started_at)),
            elapsed_seconds: if self.log.is_some() { t.task } else { 0 },
            today_work_seconds: t.work,
            today_break_seconds: t.brk,
            overtime: self.overtime,
            break_info: self.break_info.as_ref().filter(|_| self.state == TimerState::Break).map(|b| BreakInfoDto {
                reason_text: b.reason_text.clone(),
                limit_seconds: b.limit_secs,
                started_at: time::ui_iso(&b.started_at),
            }),
            queued,
            online,
        }
    }
}

pub fn state_word(s: TimerState) -> &'static str {
    match s {
        TimerState::Stopped => "stopped",
        TimerState::Working => "working",
        TimerState::Paused => "paused",
        TimerState::Away => "away",
        TimerState::Break => "on a break",
        TimerState::Idle => "idle",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn task() -> TaskRef {
        TaskRef { task_id: 5, title: "T".into(), project_id: 1, project_name: "P".into(), path: vec!["T".into()] }
    }

    fn log(id: i64) -> ActiveLog {
        ActiveLog { id, task: task(), started_at: time::parse_server_ts("2026-11-14T10:00:00").unwrap() }
    }

    fn s(n: u64) -> Duration {
        Duration::from_secs(n)
    }

    #[test]
    fn full_cycle_accrues_time_by_state() {
        let t0 = Instant::now();
        let mut m = TimerModel::new(t0);
        assert!(m.check(Action::Pause).is_err());
        m.start(log(1), TimerState::Working, Totals { task: 100, work: 1000, brk: 50 }, t0, true);
        assert_eq!(m.totals(t0 + s(10)), Totals { task: 110, work: 1010, brk: 50 });

        m.apply(Action::Pause, t0 + s(10)).unwrap();
        // Productive pause still counts (server accounting).
        assert_eq!(m.totals(t0 + s(20)).work, 1020);

        m.apply(Action::Resume, t0 + s(20)).unwrap();
        m.apply(Action::BreakStart, t0 + s(30)).unwrap();
        assert_eq!(m.state, TimerState::Break);
        assert_eq!(m.totals(t0 + s(90)), Totals { task: 130, work: 1030, brk: 110 });
        assert!(m.check(Action::Pause).is_err());
        m.apply(Action::BreakEnd, t0 + s(90)).unwrap();

        m.apply(Action::Away, t0 + s(100)).unwrap();
        assert_eq!(m.totals(t0 + s(200)), Totals { task: 140, work: 1040, brk: 110 });
        m.apply(Action::Resume, t0 + s(200)).unwrap();

        m.apply(Action::Stop, t0 + s(210)).unwrap();
        assert_eq!(m.state, TimerState::Stopped);
        assert!(m.log.is_none());
        let snap = m.snapshot(t0 + s(300), 0, true);
        assert_eq!(snap.elapsed_seconds, 0);
        assert_eq!(snap.today_work_seconds, 1050);
        assert!(m.check(Action::Stop).is_err());
    }

    #[test]
    fn idle_subtracts_threshold_and_resumes() {
        let t0 = Instant::now();
        let mut m = TimerModel::new(t0);
        m.start(log(1), TimerState::Working, Totals { task: 0, work: 0, brk: 0 }, t0, true);
        m.apply(Action::IdleStart { subtract: 300 }, t0 + s(400)).unwrap();
        assert_eq!(m.totals(t0 + s(1000)).work, 100);
        assert!(m.check(Action::Pause).is_err());
        m.apply(Action::IdleEnd, t0 + s(1000)).unwrap();
        assert_eq!(m.totals(t0 + s(1010)).work, 110);
        // Subtraction never underflows.
        m.apply(Action::IdleStart { subtract: 10_000 }, t0 + s(1010)).unwrap();
        assert_eq!(m.totals(t0 + s(1010)).work, 0);
        // Resume also works from idle (UI "Resume" button).
        assert!(m.check(Action::Resume).is_ok());
    }

    #[test]
    fn allowed_transitions() {
        let t0 = Instant::now();
        let mut m = TimerModel::new(t0);
        m.start(log(1), TimerState::Working, Totals::default(), t0, true);
        assert!(m.check(Action::Resume).is_err());
        assert!(m.check(Action::BreakEnd).is_err());
        m.apply(Action::Pause, t0).unwrap();
        assert!(m.check(Action::Away).is_err());
        assert!(m.check(Action::BreakStart).is_err());
        assert!(m.check(Action::Stop).is_ok());
        m.apply(Action::Resume, t0).unwrap();
        m.apply(Action::Away, t0).unwrap();
        assert!(m.check(Action::Resume).is_ok());
    }

    #[test]
    fn overtime_and_break_limit() {
        let t0 = Instant::now();
        let mut m = TimerModel::new(t0);
        m.start(log(1), TimerState::Working, Totals { task: 0, work: 28_790, brk: 0 }, t0, true);
        assert!(!m.overtime_due(t0 + s(5), 28_800));
        assert!(m.overtime_due(t0 + s(10), 28_800));
        m.overtime_prompted = true;
        assert!(!m.overtime_due(t0 + s(20), 28_800));
        assert_eq!(m.working_server_state(), ServerState::ActiveProductive);
        m.overtime = true;
        assert_eq!(m.working_server_state(), ServerState::Overtime);

        m.apply(Action::BreakStart, t0 + s(20)).unwrap();
        m.break_info = Some(BreakState {
            reason_text: "Tea".into(),
            limit_secs: Some(900),
            started_at: Local::now(),
            started: t0 + s(20),
            warned: false,
        });
        assert!(!m.break_over_limit(t0 + s(900)));
        assert!(m.break_over_limit(t0 + s(920)));
        let snap = m.snapshot(t0 + s(30), 2, false);
        assert_eq!(snap.break_info.unwrap().limit_seconds, Some(900));
        assert_eq!(snap.queued, 2);
        assert!(!snap.online);
    }

    #[test]
    fn grace_and_adopt() {
        let t0 = Instant::now();
        let mut m = TimerModel::new(t0);
        m.start(log(1), TimerState::Working, Totals::default(), t0, true);
        assert!(m.in_grace(t0 + s(10), 15));
        assert!(!m.in_grace(t0 + s(16), 15));
        m.apply(Action::BreakStart, t0).unwrap();
        m.adopt_state(TimerState::Away, false, t0);
        assert_eq!(m.state, TimerState::Break);
        m.adopt_state(TimerState::Paused, false, t0);
        assert_eq!(m.state, TimerState::Paused);
        m.set_log(9, None);
        assert_eq!(m.log.as_ref().unwrap().id, 9);
    }

    #[test]
    fn server_state_mapping_and_fallback_limits() {
        assert_eq!(state_from_server(Some("ACTIVE_PRODUCTIVE")), (TimerState::Working, false));
        assert_eq!(state_from_server(Some("OVERTIME")), (TimerState::Working, true));
        assert_eq!(state_from_server(Some("productive_pause")), (TimerState::Paused, false));
        assert_eq!(state_from_server(Some("AWAY")), (TimerState::Away, false));
        assert_eq!(state_from_server(Some("IDLE")), (TimerState::Idle, false));
        assert_eq!(state_from_server(None), (TimerState::Working, false));
        assert_eq!(fallback_break_limit("Tea Break"), Some(15));
        assert_eq!(fallback_break_limit("Coffee"), Some(15));
        assert_eq!(fallback_break_limit("Lunch"), Some(30));
        assert_eq!(fallback_break_limit("Dinner"), Some(30));
        assert_eq!(fallback_break_limit("Meeting"), None);
    }
}
