//! The agent core: owns auth, API, timer model and trackers, and runs the background loops
//! (1 s tick, 30 s heartbeat, 30 s active-timer poll, 5 s power check, offline queue).
//! Every server-changing timer operation is serialized through `op`.

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use chrono::{DateTime, FixedOffset, Local, Utc};

use crate::alive::{self, AliveFile, AliveState};
use crate::api::{Api, ServerState, TimeLog};
use crate::auth::{Auth, SecretStore};
use crate::catalog::{self, Catalog};
use crate::config::Config;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::queue::{Job, Queue};
use crate::settings::{SettingsCache, TrackApps, TrackingSettings};
use crate::timer::{self, Action, ActiveLog, BreakState, TimerModel, Totals};
use crate::tracker::apps::{self, UsageTracker, WindowInfo};
use crate::tracker::idle::{self, ActivitySampler};
use crate::tracker::power::{self, PowerEvent, PowerWatch};
use crate::tracker::screenshot::{self, ScreenshotSchedule};
use crate::types::*;
use crate::ui::Ui;

const FIRST_RUN_FILE: &str = "first-run-notice-accepted";

#[derive(Default)]
struct Track {
    usage: UsageTracker,
    sampler: ActivitySampler,
    schedule: Option<ScreenshotSchedule>,
    last_window: Option<WindowInfo>,
    usage_log_id: Option<i64>,
}

/// A log that must be ended at a known time before the poll may adopt it again (see `alive.rs`).
#[derive(Debug, Clone)]
struct Pending {
    state: AliveState,
    /// Written by a stop that could not reach the server: end it whatever its age.
    forced: bool,
    /// Why the timer stopped, for the notice ("turned off"); `None` when the employee was already told.
    reason: Option<&'static str>,
}

/// Stopping the timer when the OS shuts down: the whole stop, including the one HTTP call, must fit in this.
pub const EXIT_STOP_BUDGET: Duration = Duration::from_secs(3);

pub struct Core {
    pub cfg: Config,
    pub auth: Arc<Auth>,
    pub api: Arc<Api>,
    pub settings: SettingsCache,
    pub queue: Arc<Queue>,
    pub ui: Ui,
    pub catalog: Catalog,
    timer: Mutex<TimerModel>,
    op: tokio::sync::Mutex<()>,
    track: Mutex<Track>,
    reasons: Mutex<Vec<BreakReason>>,
    poll_now: tokio::sync::Notify,
    idle_busy: AtomicBool,
    locked: AtomicBool,
    last_resume_attempt: Mutex<Option<Instant>>,
    alive: AliveFile,
    pending: Mutex<Option<Pending>>,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

fn now_fixed() -> DateTime<FixedOffset> {
    Local::now().fixed_offset()
}

fn log_start(log: &TimeLog) -> Option<DateTime<FixedOffset>> {
    log.start_time.as_deref().and_then(crate::time::parse_server_ts)
}

impl Core {
    pub fn new(cfg: Config, store: Arc<dyn SecretStore>) -> Arc<Self> {
        let http = crate::api::build_client();
        let auth = Arc::new(Auth::new(http.clone(), cfg.axis_url.clone(), store));
        let api = Arc::new(Api::new(http, cfg.api_url.clone(), auth.clone()));
        let queue = Arc::new(Queue::new(cfg.data_dir.join("queue")));
        let alive = AliveFile::new(&cfg.data_dir);
        // A record left by the previous run: the computer or the app went away without a clean stop.
        let pending = alive.load().map(|state| Pending { state, forced: false, reason: Some("turned off") });
        Arc::new(Self {
            settings: SettingsCache::new(cfg.timings.settings_ttl),
            cfg,
            auth,
            api,
            queue,
            ui: Ui::default(),
            catalog: Catalog::default(),
            timer: Mutex::new(TimerModel::default()),
            op: tokio::sync::Mutex::new(()),
            track: Mutex::new(Track::default()),
            reasons: Mutex::new(Vec::new()),
            poll_now: tokio::sync::Notify::new(),
            idle_busy: AtomicBool::new(false),
            locked: AtomicBool::new(false),
            last_resume_attempt: Mutex::new(None),
            alive,
            pending: Mutex::new(pending),
        })
    }

    // ── Snapshots / session ─────────────────────────────────────────────────

    pub fn snapshot(&self) -> TimerSnapshot {
        lock(&self.timer).snapshot(Instant::now(), self.queue.len(), self.api.is_online())
    }

    pub fn is_running(&self) -> bool {
        lock(&self.timer).is_running()
    }

    pub fn timer_state(&self) -> TimerState {
        lock(&self.timer).state
    }

    pub fn emit_timer(&self) -> TimerSnapshot {
        self.touch_alive();
        let snap = self.snapshot();
        self.ui.emit(events::TIMER_CHANGED, snap.clone());
        if let Some(app) = self.ui.app() {
            crate::tray::refresh(app, self);
        }
        snap
    }

    /// Write the "last known alive" record while a timer runs (state change or heartbeat). Never deletes: only a
    /// confirmed stop does, otherwise start-up would erase the very record the guard is about to read.
    fn touch_alive(&self) {
        let cur = lock(&self.timer).log.as_ref().map(|l| (l.id, l.task.task_id));
        if let Some((time_log_id, task_id)) = cur {
            self.alive.save(&AliveState { time_log_id, task_id, last_alive_at: Utc::now() });
        }
    }

    /// Refresh the alive record right now (about to sleep).
    #[cfg(target_os = "linux")]
    pub(crate) fn persist_alive_now(&self) {
        self.touch_alive();
    }

    /// A stop did not reach the server: remember to end the log at `at` before it can be adopted again.
    fn remember_pending_end(&self, time_log_id: i64, task_id: i64, at: DateTime<Local>) {
        let state = AliveState { time_log_id, task_id, last_alive_at: at.with_timezone(&Utc) };
        self.alive.save(&state);
        *lock(&self.pending) = Some(Pending { state, forced: true, reason: None });
    }

    /// Hold the operation lock if nothing else is changing the timer (used by the updater).
    pub(crate) fn try_lock_op(&self) -> Option<tokio::sync::MutexGuard<'_, ()>> {
        self.op.try_lock().ok()
    }

    pub(crate) async fn lock_op(&self) -> tokio::sync::MutexGuard<'_, ()> {
        self.op.lock().await
    }

    fn first_run_path(&self) -> std::path::PathBuf {
        self.cfg.data_dir.join(FIRST_RUN_FILE)
    }

    pub fn first_run_accepted(&self) -> bool {
        self.first_run_path().exists()
    }

    pub fn accept_first_run_notice(&self) -> AppResult<()> {
        std::fs::create_dir_all(&self.cfg.data_dir).map_err(|e| AppError::server(e.to_string()))?;
        std::fs::write(self.first_run_path(), Local::now().to_rfc3339()).map_err(|e| AppError::server(e.to_string()))?;
        if let Some(s) = self.session_cached() {
            self.ui.emit(events::SESSION_CHANGED, Some(s));
        }
        Ok(())
    }

    fn build_session(&self, settings: &TrackingSettings) -> Option<Session> {
        let id = self.auth.identity()?;
        let companies = id
            .memberships
            .iter()
            .map(|m| Company {
                tenant_id: m.tenant_id.clone(),
                name: m.tenant_name.clone().or_else(|| m.slug.clone()).unwrap_or_else(|| m.tenant_id.clone()),
                status: m.status.clone().unwrap_or_else(|| "active".into()),
            })
            .collect();
        Some(Session {
            user: SessionUser {
                id: id.user.id.clone(),
                email: id.user.email.clone(),
                display_name: id.user.best_display_name(),
                avatar_url: id.user.avatar_url.clone().filter(|u| !u.trim().is_empty()),
            },
            companies,
            active_tenant_id: id.active_tenant_id,
            tracking_mode: settings.mode,
            first_run_notice_accepted: self.first_run_accepted(),
        })
    }

    /// Session from cached settings only (no network).
    pub fn session_cached(&self) -> Option<Session> {
        self.build_session(&self.settings.peek().unwrap_or_default())
    }

    pub async fn session(&self) -> Option<Session> {
        if !self.auth.is_signed_in() {
            return None;
        }
        let settings = self.settings.get(&self.api).await;
        self.ui.set_silent(settings.mode == TrackingMode::Silent);
        self.build_session(&settings)
    }

    pub fn silent(&self) -> bool {
        self.ui.silent()
    }

    fn me(&self) -> HashSet<String> {
        let mut ids = HashSet::new();
        if let Some(i) = self.auth.identity()
            && !i.user.id.is_empty()
        {
            ids.insert(i.user.id.to_lowercase());
        }
        if let Some(e) = self.settings.peek().and_then(|s| s.employee_id) {
            ids.insert(e.to_lowercase());
        }
        ids
    }

    fn require_signed_in(&self) -> AppResult<()> {
        if self.auth.is_signed_in() { Ok(()) } else { Err(AppError::not_signed_in()) }
    }

    // ── Auth commands ───────────────────────────────────────────────────────

    pub async fn sign_in(&self, email: &str, password: &str) -> AppResult<Session> {
        if self.auth.is_signed_in() {
            self.sign_out().await?;
        }
        self.auth.sign_in(email, password).await?;
        self.after_sign_in().await
    }

    async fn after_sign_in(&self) -> AppResult<Session> {
        self.clear_caches();
        if let Err(e) = self.settings.refresh(&self.api).await {
            log::warn!("settings after sign-in: {e}");
        }
        let s = self.session().await.ok_or_else(AppError::not_signed_in)?;
        self.ui.emit(events::SESSION_CHANGED, Some(s.clone()));
        if let Some(app) = self.ui.app() {
            crate::tray::refresh(app, self);
        }
        self.poll_now.notify_one();
        Ok(s)
    }

    fn clear_caches(&self) {
        self.settings.clear();
        self.catalog.clear();
        lock(&self.reasons).clear();
    }

    pub async fn sign_out(&self) -> AppResult<()> {
        if self.is_running()
            && let Err(e) = self.stop_timer_inner(true).await
        {
            log::warn!("stop before sign-out: {e}");
        }
        self.auth.sign_out().await;
        self.reset_local();
        self.ui.emit(events::SESSION_CHANGED, None::<Session>);
        self.emit_timer();
        Ok(())
    }

    fn reset_local(&self) {
        self.clear_caches();
        *lock(&self.timer) = TimerModel::default();
        self.stop_tracking();
        self.ui.set_silent(false);
    }

    async fn handle_forced_sign_out(&self) {
        let _g = self.op.lock().await;
        let was_running = self.is_running();
        self.flush_usage(Local::now());
        self.reset_local();
        self.ui.emit(events::SESSION_CHANGED, None::<Session>);
        self.emit_timer();
        let msg = if was_running {
            "Your session ended, so tracking stopped. Please sign in again."
        } else {
            "Your session ended. Please sign in again."
        };
        self.ui.toast(ToastKind::Warning, msg);
        self.ui.notify("PMS Desktop", msg);
    }

    pub async fn switch_company(&self, tenant_id: &str) -> AppResult<Session> {
        let _g = self.op.lock().await;
        self.require_signed_in()?;
        if self.is_running() {
            return Err(AppError::busy("Stop the timer before switching company."));
        }
        let known = self.auth.identity().is_some_and(|i| i.memberships.iter().any(|m| m.tenant_id == tenant_id));
        if !known {
            return Err(AppError::validation("You're not a member of that company."));
        }
        self.auth.switch_tenant(tenant_id).await?;
        drop(_g);
        self.after_sign_in().await
    }

    /// Start-up: dev auto sign-in (debug only) or restore the stored session. Returns signed-in.
    pub async fn startup(&self) -> bool {
        if cfg!(debug_assertions)
            && !self.auth.has_stored_session()
            && let (Some(e), Some(p)) = (self.cfg.dev_email.clone(), self.cfg.dev_password.clone())
        {
            return match self.sign_in(&e, &p).await {
                Ok(_) => true,
                Err(err) => {
                    log::warn!("dev auto sign-in failed: {err}");
                    false
                }
            };
        }
        match self.auth.restore().await {
            Ok(true) => self.after_sign_in().await.is_ok(),
            Ok(false) => false,
            Err(e) => {
                log::warn!("session restore failed: {e}");
                false
            }
        }
    }

    // ── Catalogue commands ──────────────────────────────────────────────────

    pub async fn list_projects(&self) -> AppResult<Vec<Project>> {
        self.require_signed_in()?;
        self.catalog.projects(&self.api).await
    }

    async fn ensure_me(&self) -> HashSet<String> {
        if self.settings.peek().is_none() {
            let _ = self.settings.get(&self.api).await;
        }
        self.me()
    }

    pub async fn list_tasks(&self, project_id: i64) -> AppResult<Vec<TaskNode>> {
        self.require_signed_in()?;
        let me = self.ensure_me().await;
        Ok(catalog::to_nodes(&self.api.project_tasks(project_id).await?, &me))
    }

    pub async fn list_subtasks(&self, task_id: i64) -> AppResult<Vec<TaskNode>> {
        self.require_signed_in()?;
        let me = self.ensure_me().await;
        Ok(catalog::to_nodes(&self.api.subtasks(task_id).await?, &me))
    }

    pub async fn search_tasks(&self, query: &str) -> AppResult<Vec<TaskRef>> {
        self.require_signed_in()?;
        if query.trim().is_empty() {
            return Ok(Vec::new());
        }
        let me = self.ensure_me().await;
        let idx = self.catalog.index(&self.api, &me).await?;
        Ok(catalog::search(&idx, query, catalog::SEARCH_LIMIT))
    }

    pub async fn recent_tasks(&self) -> AppResult<Vec<TaskRef>> {
        self.require_signed_in()?;
        let logs = self.api.time_logs().await?;
        Ok(catalog::recent_from_logs(logs, &self.catalog.cached(), catalog::RECENT_LIMIT))
    }

    pub async fn list_break_reasons(&self) -> AppResult<Vec<BreakReason>> {
        self.require_signed_in()?;
        let reasons = self.api.break_reasons().await?;
        *lock(&self.reasons) = reasons.clone();
        Ok(reasons)
    }

    // ── Timer commands ──────────────────────────────────────────────────────

    async fn fetch_totals(&self, task_id: Option<i64>) -> Option<Totals> {
        let (w, b, t) = tokio::join!(self.api.accumulated_today(), self.api.accumulated_break_today(), async {
            match task_id {
                Some(id) => self.api.task_accumulated_today(id).await,
                None => Ok(0),
            }
        });
        Some(Totals { task: t.ok()?, work: w.ok()?, brk: b.ok()? })
    }

    fn fallback_totals(&self) -> Totals {
        let t = lock(&self.timer).totals(Instant::now());
        Totals { task: 0, ..t }
    }

    pub async fn start_timer(&self, task: TaskRef) -> AppResult<TimerSnapshot> {
        let _g = self.op.lock().await;
        self.require_signed_in()?;
        let prev = lock(&self.timer).log.clone();
        if let Some(prev) = prev {
            self.flush_usage(Local::now());
            if let Err(e) = self.api.end(prev.task.task_id, None).await {
                if e.code == ErrorCode::Offline {
                    return Err(e);
                }
                log::warn!("ending previous log failed: {e}");
            }
            let _ = lock(&self.timer).apply(Action::Stop, Instant::now());
            self.stop_tracking();
        }
        let log = self.api.start(task.task_id).await?;
        let id = log.id.ok_or_else(|| AppError::server("PMS did not return a time log."))?;
        let totals = self.fetch_totals(Some(task.task_id)).await.unwrap_or_else(|| self.fallback_totals());
        let started_at = log_start(&log).unwrap_or_else(now_fixed);
        let today = Local::now().date_naive();
        let continue_overtime = {
            let mut m = lock(&self.timer);
            m.start(ActiveLog { id, task, started_at }, TimerState::Working, totals, Instant::now(), true);
            m.overtime_accepted_on == Some(today)
        };
        self.begin_tracking(id).await;
        if continue_overtime {
            self.mark_overtime().await;
        }
        Ok(self.emit_timer())
    }

    /// Server transition + local action, with app usage flushed to the old log first.
    async fn transition(&self, action: Action, server: ServerState) -> AppResult<()> {
        let task_id = {
            let m = lock(&self.timer);
            m.check(action)?;
            m.log.as_ref().map(|l| l.task.task_id).ok_or_else(|| AppError::validation("No timer is running."))?
        };
        self.flush_usage(Local::now());
        let log = self.api.transition(task_id, server, Local::now()).await?;
        {
            let mut m = lock(&self.timer);
            m.apply(action, Instant::now())?;
            if let Some(id) = log.id {
                m.set_log(id, log_start(&log));
            }
        }
        self.retarget_tracking();
        Ok(())
    }

    pub async fn pause_timer(&self) -> AppResult<TimerSnapshot> {
        let _g = self.op.lock().await;
        self.transition(Action::Pause, ServerState::ProductivePause).await?;
        Ok(self.emit_timer())
    }

    pub async fn resume_timer(&self) -> AppResult<TimerSnapshot> {
        let _g = self.op.lock().await;
        if self.timer_state() == TimerState::Idle {
            self.resume_from_idle_locked(false).await?;
        } else {
            let server = lock(&self.timer).working_server_state();
            self.transition(Action::Resume, server).await?;
        }
        Ok(self.emit_timer())
    }

    pub async fn away_timer(&self) -> AppResult<TimerSnapshot> {
        let _g = self.op.lock().await;
        self.transition(Action::Away, ServerState::Away).await?;
        Ok(self.emit_timer())
    }

    pub async fn stop_timer(&self) -> AppResult<TimerSnapshot> {
        self.stop_timer_inner(false).await
    }

    /// `force_local`: stop locally even if the server can't be reached (sign-out, quit, auto-stop).
    pub async fn stop_timer_inner(&self, force_local: bool) -> AppResult<TimerSnapshot> {
        let _g = self.op.lock().await;
        self.stop_locked(force_local, None).await
    }

    /// `end_at`: when the work really ended (sleep start); `None` = now. Stops locally even if the server can't be
    /// reached when `force_local`; the log is then remembered and ended at `end_at` before it can be adopted again.
    async fn stop_locked(&self, force_local: bool, end_at: Option<DateTime<Local>>) -> AppResult<TimerSnapshot> {
        let (log_id, task_id, end_at) = {
            let m = lock(&self.timer);
            m.check(Action::Stop)?;
            let log = m.log.as_ref();
            (
                log.map(|l| l.id),
                log.map(|l| l.task.task_id),
                end_at.map(|t| log.map_or(t, |l| alive::clamp_end(t, l.started_at))),
            )
        };
        self.flush_usage(end_at.unwrap_or_else(Local::now));
        if let Some(task_id) = task_id {
            match self.api.end(task_id, end_at).await {
                Ok(()) => {
                    if let Some(id) = log_id {
                        self.alive.clear_for(id);
                    }
                }
                Err(e) => {
                    if !force_local {
                        return Err(e);
                    }
                    log::warn!("server stop failed, stopped locally: {e}");
                    if let Some(id) = log_id {
                        self.remember_pending_end(id, task_id, end_at.unwrap_or_else(Local::now));
                    }
                }
            }
        }
        let _ = lock(&self.timer).apply(Action::Stop, Instant::now());
        self.stop_tracking();
        if let Some(t) = self.fetch_totals(None).await {
            lock(&self.timer).sync_totals(t, Instant::now());
        }
        Ok(self.emit_timer())
    }

    pub async fn start_break(&self, reason_id: &str) -> AppResult<TimerSnapshot> {
        let _g = self.op.lock().await;
        let log_id = {
            let m = lock(&self.timer);
            m.check(Action::BreakStart)?;
            m.log.as_ref().map(|l| l.id).ok_or_else(|| AppError::validation("No timer is running."))?
        };
        let mut reason = lock(&self.reasons).iter().find(|r| r.id == reason_id).cloned();
        if reason.is_none() {
            if let Ok(list) = self.api.break_reasons().await {
                *lock(&self.reasons) = list;
            }
            reason = lock(&self.reasons).iter().find(|r| r.id == reason_id).cloned();
        }
        let reason = reason.ok_or_else(|| AppError::validation("Unknown break reason."))?;
        self.flush_usage(Local::now());
        self.api.break_start(log_id, reason_id).await?;
        let limit = reason.duration_limit_minutes.or_else(|| timer::fallback_break_limit(&reason.reason_text));
        {
            let mut m = lock(&self.timer);
            m.apply(Action::BreakStart, Instant::now())?;
            m.break_info = Some(BreakState {
                reason_text: reason.reason_text.clone(),
                limit_secs: limit.map(|l| u64::from(l) * 60),
                started_at: Local::now(),
                started: Instant::now(),
                warned: false,
            });
        }
        Ok(self.emit_timer())
    }

    pub async fn end_break(&self) -> AppResult<TimerSnapshot> {
        let _g = self.op.lock().await;
        let (log_id, overtime) = {
            let m = lock(&self.timer);
            m.check(Action::BreakEnd)?;
            (m.log.as_ref().map(|l| l.id).ok_or_else(|| AppError::validation("No timer is running."))?, m.overtime)
        };
        self.api.break_stop(log_id).await?;
        lock(&self.timer).apply(Action::BreakEnd, Instant::now())?;
        if overtime {
            self.mark_overtime().await;
        }
        let id = lock(&self.timer).log.as_ref().map(|l| l.id);
        if let Some(id) = id
            && let Err(e) = self.api.heartbeat(id).await
        {
            log::debug!("heartbeat after break: {e}");
        }
        self.retarget_tracking();
        Ok(self.emit_timer())
    }

    pub async fn submit_idle_note(&self, text: &str) -> AppResult<()> {
        let text = text.trim();
        if text.is_empty() {
            return Err(AppError::validation("Please enter a note."));
        }
        if text.chars().count() > 120 {
            return Err(AppError::validation("Notes can be at most 120 characters."));
        }
        let log_id = {
            let m = lock(&self.timer);
            m.idle_note_log.or_else(|| m.log.as_ref().map(|l| l.id))
        };
        let log_id = log_id.ok_or_else(|| AppError::validation("There's no idle period to add a note to."))?;
        self.api.add_note(log_id, text).await
    }

    pub async fn overtime_decision(&self, continue_overtime: bool) -> AppResult<TimerSnapshot> {
        let _g = self.op.lock().await;
        if !continue_overtime {
            return self.stop_locked(false, None).await;
        }
        {
            let mut m = lock(&self.timer);
            if !m.is_running() {
                return Err(AppError::validation("No timer is running."));
            }
            m.overtime_prompted = true;
            m.overtime_accepted_on = Some(Local::now().date_naive());
        }
        self.mark_overtime().await;
        Ok(self.emit_timer())
    }

    /// Flag overtime locally and, when working, move the server log to OVERTIME.
    async fn mark_overtime(&self) {
        let (task_id, working) = {
            let mut m = lock(&self.timer);
            m.overtime = true;
            m.overtime_prompted = true;
            (m.log.as_ref().map(|l| l.task.task_id), m.state == TimerState::Working)
        };
        if let (Some(task_id), true) = (task_id, working) {
            self.flush_usage(Local::now());
            match self.api.transition(task_id, ServerState::Overtime, Local::now()).await {
                Ok(log) => {
                    if let Some(id) = log.id {
                        lock(&self.timer).set_log(id, log_start(&log));
                    }
                    self.retarget_tracking();
                }
                Err(e) => log::warn!("overtime transition failed: {e}"),
            }
        }
    }

    // ── Idle ────────────────────────────────────────────────────────────────

    pub(crate) async fn go_idle(&self, idle_secs: u64) {
        let _g = self.op.lock().await;
        let task_id = {
            let m = lock(&self.timer);
            if m.state != TimerState::Working {
                return;
            }
            m.log.as_ref().map(|l| l.task.task_id)
        };
        let Some(task_id) = task_id else { return };
        let effective = Local::now() - chrono::Duration::seconds(idle_secs as i64);
        self.flush_usage(effective);
        let res = self.api.transition(task_id, ServerState::Idle, effective).await;
        {
            let mut m = lock(&self.timer);
            let _ = m.apply(Action::IdleStart { subtract: idle_secs }, Instant::now());
            match &res {
                Ok(log) => {
                    if let Some(id) = log.id {
                        m.set_log(id, log_start(log));
                        m.idle_note_log = Some(id);
                    }
                }
                Err(e) => {
                    log::warn!("IDLE transition failed: {e}");
                    m.idle_note_log = m.log.as_ref().map(|l| l.id);
                }
            }
        }
        self.retarget_tracking();
        let note = self.settings.peek().unwrap_or_default().idle_note;
        self.ui.prompt(events::IDLE_STARTED, IdleStarted { idle_seconds: idle_secs, note });
        if !self.silent() {
            if note != IdleNoteMode::Off {
                self.ui.show_window();
            }
            self.ui.notify("You're idle", "No activity detected, so work time is paused until you're back.");
        }
        self.emit_timer();
    }

    async fn resume_from_idle_locked(&self, automatic: bool) -> AppResult<()> {
        let (task_id, server) = {
            let m = lock(&self.timer);
            m.check(Action::IdleEnd)?;
            (m.log.as_ref().map(|l| l.task.task_id).ok_or_else(|| AppError::validation("No timer is running."))?, m.working_server_state())
        };
        let log = match self.api.transition(task_id, server, Local::now()).await {
            Ok(l) => l,
            Err(e) if e.code == ErrorCode::Offline => return Err(e),
            Err(e) => {
                log::warn!("resume transition failed ({e}); starting a new log");
                self.api.start(task_id).await?
            }
        };
        {
            let mut m = lock(&self.timer);
            m.apply(Action::IdleEnd, Instant::now())?;
            if let Some(id) = log.id {
                m.set_log(id, log_start(&log));
            }
        }
        self.retarget_tracking();
        self.ui.prompt(events::IDLE_ENDED, IdleEnded { resumed: true });
        if automatic {
            self.ui.toast(ToastKind::Success, "Tracking resumed");
        }
        Ok(())
    }

    pub(crate) async fn auto_resume(&self) {
        let _g = self.op.lock().await;
        if self.timer_state() != TimerState::Idle {
            return;
        }
        match self.resume_from_idle_locked(true).await {
            Ok(()) => {
                self.emit_timer();
            }
            Err(e) => log::warn!("auto-resume failed: {e}"),
        }
    }

    async fn auto_stop_idle(&self) {
        let _g = self.op.lock().await;
        if self.timer_state() != TimerState::Idle {
            return;
        }
        if self.stop_locked(true, None).await.is_ok() {
            let mins = self.cfg.timings.idle_autostop.as_secs() / 60;
            let msg = format!("Your timer was stopped after {mins} minutes of inactivity.");
            self.ui.prompt(events::IDLE_ENDED, IdleEnded { resumed: false });
            self.ui.toast(ToastKind::Warning, msg.clone());
            self.ui.notify("Timer stopped", &msg);
        }
    }

    // ── Tracking (apps, activity, screenshots) ──────────────────────────────

    async fn begin_tracking(&self, log_id: i64) {
        let settings = self.settings.get(&self.api).await;
        let interval = self.cfg.timings.screenshot_override.unwrap_or(settings.screenshot_interval);
        let mut t = lock(&self.track);
        t.usage = UsageTracker::default();
        t.sampler.reset();
        t.schedule = Some(ScreenshotSchedule::new(interval, Instant::now(), fastrand::f64()));
        t.usage_log_id = Some(log_id);
    }

    /// The open log changed (transition): new app-usage records go to the new log id.
    fn retarget_tracking(&self) {
        let id = lock(&self.timer).log.as_ref().map(|l| l.id);
        lock(&self.track).usage_log_id = id;
    }

    fn stop_tracking(&self) {
        let mut t = lock(&self.track);
        *t = Track::default();
    }

    /// Close app-usage sessions at `at` and enqueue them for the log they belong to.
    fn flush_usage(&self, at: DateTime<Local>) {
        let (records, log_id) = {
            let mut t = lock(&self.track);
            (t.usage.finish(at), t.usage_log_id)
        };
        self.enqueue_usage(records, log_id);
    }

    fn enqueue_usage(&self, records: Vec<apps::UsageRecord>, log_id: Option<i64>) {
        let Some(log_id) = log_id else { return };
        let mode = self.settings.peek().map(|s| s.track_apps).unwrap_or(TrackApps::Both);
        if let Some(items) = apps::usage_payload(&records, log_id, mode)
            && let Err(e) = self.queue.enqueue(Job::AppUsage { items }, None)
        {
            log::warn!("queue app usage: {e}");
        }
    }

    fn window_title_for_upload(&self, mode: TrackApps) -> String {
        let w = lock(&self.track).last_window.clone();
        let Some(w) = w else { return apps::UNKNOWN_APP.into() };
        match mode {
            TrackApps::Off => "Restricted".into(),
            TrackApps::AppsOnly => w.app,
            TrackApps::UrlsOnly => w.title,
            TrackApps::Both if w.title.is_empty() => w.app,
            TrackApps::Both => format!("{} - {}", w.title, w.app),
        }
    }

    /// Capture one screenshot for the current log, honouring blur and app/URL masking.
    /// `Ok(None)` when not working. Returns the queue job, the JPEG and whether to notify.
    pub(crate) async fn capture_job(&self) -> Result<Option<(Job, Vec<u8>, bool)>, String> {
        let settings = self.settings.get(&self.api).await;
        let log_id = {
            let m = lock(&self.timer);
            if m.state != TimerState::Working {
                return Ok(None);
            }
            m.log.as_ref().map(|l| l.id)
        };
        let Some(log_id) = log_id else { return Ok(None) };
        let activity = {
            let mut t = lock(&self.track);
            let p = t.sampler.percent();
            t.sampler.reset();
            p
        };
        let title = self.window_title_for_upload(settings.track_apps);
        let captured_at = crate::time::api_now();
        let blur = settings.blur;
        let jpeg = tokio::task::spawn_blocking(move || screenshot::capture_jpeg(blur)).await.map_err(|e| e.to_string())??;
        let job = Job::Screenshot { time_log_id: log_id, captured_at, activity_percent: activity, active_window_title: title };
        Ok(Some((job, jpeg, settings.screenshot_notifications)))
    }

    async fn capture_screenshot(&self) {
        match self.capture_job().await {
            Ok(Some((job, jpeg, notify))) => {
                if let Err(e) = self.queue.enqueue(job, Some(&jpeg)) {
                    log::warn!("queue screenshot: {e}");
                } else if notify {
                    self.ui.notify("Screenshot captured", "PMS Desktop captured your screen for your timesheet.");
                }
            }
            Ok(None) => {}
            // Once per run: on a Linux Wayland session (or a locked-down PC) every interval would fail the same way.
            Err(e) => {
                static WARNED: AtomicBool = AtomicBool::new(false);
                if WARNED.swap(true, Ordering::Relaxed) {
                    log::debug!("screenshot capture failed: {e}");
                } else {
                    log::warn!("screenshot capture failed (further failures are not logged this run): {e}");
                }
            }
        }
    }

    /// Read the foreground window into the app-usage tracker now (normally every 5 s from the tick).
    pub(crate) async fn observe_window(&self) -> Option<WindowInfo> {
        let w = tokio::task::spawn_blocking(apps::active_window).await.ok().flatten();
        let mut tr = lock(&self.track);
        tr.usage.observe(w.clone(), Local::now());
        if w.is_some() {
            tr.last_window = w.clone();
        }
        w
    }

    /// Close the current app-usage sessions (keeping the window tracked) and build the bulk payload.
    pub(crate) fn drain_usage_payload(&self) -> Option<(serde_json::Value, usize)> {
        let (records, log_id) = {
            let mut tr = lock(&self.track);
            (tr.usage.drain(Local::now()), tr.usage_log_id)
        };
        let mode = self.settings.peek().map(|s| s.track_apps).unwrap_or(TrackApps::Both);
        apps::usage_payload(&records, log_id?, mode).map(|v| (v, records.len()))
    }

    // ── Server sync ─────────────────────────────────────────────────────────

    async fn heartbeat(&self) {
        self.touch_alive();
        let _ = self.heartbeat_once().await;
    }

    /// One heartbeat for the open log. `Ok(false)` when no log is open.
    pub(crate) async fn heartbeat_once(&self) -> AppResult<bool> {
        let id = lock(&self.timer).log.as_ref().map(|l| l.id);
        let Some(id) = id else { return Ok(false) };
        match self.api.heartbeat(id).await {
            Ok(()) => Ok(true),
            Err(e) => {
                if e.code == ErrorCode::Validation {
                    log::info!("heartbeat rejected ({e}); re-checking the active timer");
                    self.poll_now.notify_one();
                } else {
                    log::debug!("heartbeat failed: {e}");
                }
                Err(e)
            }
        }
    }

    /// The adopt guard (docs/ARCHITECTURE.md section 6): called by the poll, under `op`, with the server's active
    /// log, before it may be adopted. Returns `true` when that log must be treated as "no timer" for this poll
    /// (we ended it, or will retry ending it).
    async fn apply_pending_end(&self, active: Option<&TimeLog>, running: bool) -> bool {
        let Some(p) = lock(&self.pending).clone() else { return false };
        let server_id = active.and_then(|l| l.id);
        match alive::decide(&p.state, server_id, Utc::now(), p.forced) {
            alive::Action::Discard => {
                *lock(&self.pending) = None;
                self.alive.clear_for(p.state.time_log_id);
                false
            }
            alive::Action::Adopt => {
                *lock(&self.pending) = None;
                false
            }
            // Already tracking this very log (adopted or restarted): nothing to end.
            alive::Action::EndAt(_) if running => {
                *lock(&self.pending) = None;
                false
            }
            alive::Action::EndAt(at) => {
                let local = at.with_timezone(&Local);
                match self.api.end(p.state.task_id, Some(local)).await {
                    Ok(()) => {
                        *lock(&self.pending) = None;
                        self.alive.clear_for(p.state.time_log_id);
                        if let Some(why) = p.reason {
                            self.announce_stop(at, why);
                        }
                    }
                    Err(e) if e.is_retryable() => log::info!("ending the old log is postponed: {e}"),
                    Err(e) => {
                        // The server refused (for example it closed the log meanwhile). Do not adopt it either:
                        // its heartbeat timeout closes it.
                        log::warn!("could not end the old log at {at}: {e}");
                        *lock(&self.pending) = None;
                        self.alive.clear_for(p.state.time_log_id);
                    }
                }
                true
            }
        }
    }

    /// "Your timer was stopped at 3:07 PM when this computer turned off." (visible mode: toast + notification).
    fn announce_stop(&self, at: DateTime<Utc>, why: &str) {
        let msg = format!("Your timer was stopped at {} when this computer {why}.", alive::clock(at));
        self.ui.toast(ToastKind::Warning, msg.clone());
        self.ui.notify("Timer stopped", &msg);
    }

    /// Wake after a sleep of at least `sleep_stop_after`: end the timer at the moment sleep began.
    async fn stop_after_sleep(&self, began: DateTime<Local>) {
        let _g = self.op.lock().await;
        if !self.is_running() {
            return;
        }
        match self.stop_locked(true, Some(began)).await {
            Ok(_) => self.announce_stop(began.with_timezone(&Utc), "went to sleep"),
            Err(e) => log::warn!("stop after sleep: {e}"),
        }
    }

    /// OS shutdown, restart or log-off: end a running timer at "now", best effort, within `budget`. Blocking, and
    /// safe to call from the UI thread (Windows `WM_ENDSESSION`, which is blocked until we return) or any thread:
    /// the work runs on its own thread with its own tokio runtime and HTTP client, never touching the `op` lock,
    /// the app's runtime, the tray or the webview, all of which can be stuck waiting for the blocked UI thread.
    /// Uploads (screenshots, app usage) stay in the disk queue. On failure the alive record remains, so the
    /// next start ends the log at the last heartbeat.
    pub fn stop_on_exit(self: &Arc<Self>, budget: Duration) {
        let running = match self.timer.try_lock() {
            Ok(m) => m.log.as_ref().map(|l| (l.id, l.task.task_id)),
            Err(std::sync::TryLockError::Poisoned(p)) => p.into_inner().log.as_ref().map(|l| (l.id, l.task.task_id)),
            // Held right now: the record on disk has the same ids.
            Err(std::sync::TryLockError::WouldBlock) => self.alive.load().map(|s| (s.time_log_id, s.task_id)),
        };
        let Some((log_id, task_id)) = running else { return };
        let Some(token) = self.auth.cached_access_token() else { return };
        let now = Local::now();
        // If the call below fails, the next start ends the log here.
        self.alive.save(&AliveState { time_log_id: log_id, task_id, last_alive_at: now.with_timezone(&Utc) });
        let (tx, rx) = std::sync::mpsc::channel();
        let c = self.clone();
        let http_timeout = budget.saturating_sub(Duration::from_millis(500)).max(Duration::from_millis(500));
        let spawned = std::thread::Builder::new().name("stop-on-exit".into()).spawn(move || {
            let res = c.api.end_standalone(&token, task_id, now, http_timeout);
            if res.is_ok() {
                c.alive.clear_for(log_id);
            }
            c.flush_usage(Local::now());
            let _ = tx.send(res);
        });
        if spawned.is_err() {
            return;
        }
        match rx.recv_timeout(budget) {
            Ok(Ok(())) => log::info!("timer stopped on exit"),
            Ok(Err(e)) => log::warn!("stop on exit failed (the next start ends it): {e}"),
            Err(_) => log::warn!("stop on exit timed out (the next start ends it)"),
        }
    }

    /// 30 s poll: adopt timers started/changed on the web, stop when the server has none, re-sync totals.
    pub async fn poll(&self) {
        if !self.auth.is_signed_in() {
            if self.auth.has_stored_session() && self.auth.restore().await.is_ok() && self.auth.is_signed_in() {
                let _ = self.after_sign_in().await;
            }
            return;
        }
        let _g = self.op.lock().await;
        let active = match self.api.active().await {
            Ok(a) => a,
            Err(e) => {
                log::debug!("active timer poll failed: {e}");
                self.emit_timer();
                return;
            }
        };
        let now = Instant::now();
        let (running, local_id, in_grace) = {
            let m = lock(&self.timer);
            (m.is_running(), m.log.as_ref().map(|l| l.id), m.in_grace(now, self.cfg.timings.web_start_grace.as_secs()))
        };
        // Before any adoption: a log we know must end (computer was off, or a stop that never reached the server).
        let active = if self.apply_pending_end(active.as_ref(), running).await { None } else { active };
        match active {
            Some(log) if log.id.is_some() && log.task_id.is_some() => {
                let id = log.id.unwrap_or_default();
                let (state, overtime) = timer::state_from_server(log.time_type.as_deref());
                if !running {
                    let task = catalog::task_ref_from_log(
                        log.task_id.unwrap_or_default(),
                        log.project_id.unwrap_or_default(),
                        log.task_name.as_deref(),
                        log.project_name.as_deref(),
                        &self.catalog.cached(),
                    );
                    let totals = self.fetch_totals(Some(task.task_id)).await.unwrap_or_default();
                    {
                        let mut m = lock(&self.timer);
                        m.start(
                            ActiveLog { id, task, started_at: log_start(&log).unwrap_or_else(now_fixed) },
                            state,
                            totals,
                            Instant::now(),
                            false,
                        );
                        m.overtime = overtime;
                    }
                    self.begin_tracking(id).await;
                    self.ui.toast(ToastKind::Info, "Tracking the timer you started on the web.");
                } else {
                    let same_task = lock(&self.timer).log.as_ref().map(|l| l.task.task_id) == log.task_id;
                    if !same_task {
                        let task = catalog::task_ref_from_log(
                            log.task_id.unwrap_or_default(),
                            log.project_id.unwrap_or_default(),
                            log.task_name.as_deref(),
                            log.project_name.as_deref(),
                            &self.catalog.cached(),
                        );
                        self.flush_usage(Local::now());
                        let mut m = lock(&self.timer);
                        if let Some(l) = m.log.as_mut() {
                            l.task = task;
                        }
                    }
                    if local_id != Some(id) || !same_task {
                        let mut m = lock(&self.timer);
                        m.set_log(id, log_start(&log));
                        let local_idle = m.state == TimerState::Idle;
                        if !(local_idle && state == TimerState::Working) {
                            m.adopt_state(state, overtime, Instant::now());
                        }
                    } else {
                        let mut m = lock(&self.timer);
                        let consistent = m.state == state
                            || (m.state == TimerState::Break && state == TimerState::Away)
                            || m.state == TimerState::Idle;
                        if !consistent {
                            m.adopt_state(state, overtime, Instant::now());
                        }
                    }
                    self.retarget_tracking();
                }
            }
            _ => {
                if !(running && in_grace) {
                    // The server has nothing open, so no record can be waiting to end anything.
                    self.alive.clear();
                }
                if running && !in_grace {
                    log::info!("server reports no active timer; stopping local tracking");
                    self.flush_usage(Local::now());
                    let _ = lock(&self.timer).apply(Action::Stop, Instant::now());
                    self.stop_tracking();
                    self.ui.toast(ToastKind::Info, "Your timer was stopped outside this app.");
                }
            }
        }
        let task_id = lock(&self.timer).log.as_ref().map(|l| l.task.task_id);
        if let Some(t) = self.fetch_totals(task_id).await {
            lock(&self.timer).sync_totals(t, Instant::now());
        }
        drop(_g);
        self.emit_timer();
    }

    // ── Background loops ────────────────────────────────────────────────────

    pub fn spawn_background(self: &Arc<Self>) {

        let c = self.clone();
        tauri::async_runtime::spawn(async move { c.queue.clone().run(c.api.clone()).await });

        let c = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                c.auth.forced_out.notified().await;
                c.handle_forced_sign_out().await;
            }
        });

        let c = self.clone();
        tauri::async_runtime::spawn(async move {
            let mut iv = tokio::time::interval(c.cfg.timings.heartbeat);
            iv.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                iv.tick().await;
                c.heartbeat().await;
            }
        });

        let c = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                let _ = tokio::time::timeout(c.cfg.timings.active_poll, c.poll_now.notified()).await;
                c.poll().await;
            }
        });

        let c = self.clone();
        tauri::async_runtime::spawn(async move {
            let mut watch = PowerWatch::new(c.cfg.timings.power_check);
            let mut iv = tokio::time::interval(c.cfg.timings.power_check);
            iv.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                iv.tick().await;
                for ev in watch.check() {
                    c.on_power(ev).await;
                }
            }
        });

        let c = self.clone();
        tauri::async_runtime::spawn(async move { c.tick_loop().await });

        // Ubuntu: stop the timer on shutdown / restart (systemd-logind) and learn the exact sleep start.
        #[cfg(target_os = "linux")]
        crate::tracker::logind::spawn(self.clone());

        // Log-out and `kill` send SIGTERM: stop the timer, then leave.
        #[cfg(unix)]
        {
            let c = self.clone();
            tauri::async_runtime::spawn(async move { c.exit_on_sigterm().await });
        }
    }

    #[cfg(unix)]
    async fn exit_on_sigterm(self: Arc<Self>) {
        use tokio::signal::unix::{SignalKind, signal};
        let Ok(mut term) = signal(SignalKind::terminate()) else { return };
        if term.recv().await.is_none() {
            return;
        }
        log::info!("SIGTERM: stopping the timer and exiting");
        let c = self.clone();
        let _ = tokio::task::spawn_blocking(move || c.stop_on_exit(EXIT_STOP_BUDGET)).await;
        // Whatever happens next, do not outlive the signal for long.
        std::thread::spawn(|| {
            std::thread::sleep(Duration::from_secs(3));
            std::process::exit(0);
        });
        match self.ui.app() {
            Some(app) => app.exit(0),
            None => std::process::exit(0),
        }
    }

    async fn on_power(self: &Arc<Self>, ev: PowerEvent) {
        log::info!("power event: {ev:?}");
        match ev {
            PowerEvent::Woke { gap, began } => {
                if self.is_running()
                    && let Some(at) = power::sleep_stop_at(gap, began, self.cfg.timings.sleep_stop_after)
                {
                    self.stop_after_sleep(DateTime::<Local>::from(at)).await;
                    self.poll_now.notify_one();
                    return;
                }
                self.heartbeat().await;
                if self.timer_state() == TimerState::Working && gap >= self.cfg.timings.idle_after {
                    self.go_idle(gap.as_secs()).await;
                }
                self.poll_now.notify_one();
            }
            PowerEvent::Locked => {
                self.locked.store(true, Ordering::Relaxed);
                self.heartbeat().await;
            }
            PowerEvent::Unlocked => {
                self.locked.store(false, Ordering::Relaxed);
                self.heartbeat().await;
            }
        }
    }

    async fn tick_loop(self: Arc<Self>) {
        let t = self.cfg.timings;
        let mut iv = tokio::time::interval(Duration::from_secs(1));
        iv.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut last_emitted: Option<(TimerState, bool, usize)> = None;
        let mut last_app_poll = Instant::now() - t.app_poll;
        let mut last_sample = Instant::now();
        let mut last_flush = Instant::now();
        let mut next = fastrand::f64;
        loop {
            iv.tick().await;
            let now = Instant::now();
            let snap = self.snapshot();
            let key = (snap.state, snap.online, snap.queued);
            if snap.state != TimerState::Stopped || last_emitted != Some(key) {
                self.ui.emit(events::TIMER_CHANGED, snap.clone());
                last_emitted = Some(key);
            }
            if let Some(app) = self.ui.app() {
                crate::tray::refresh(app, &self);
            }
            if snap.state == TimerState::Stopped {
                continue;
            }

            // Overtime prompt / break limit.
            let (overtime_due, break_over) = {
                let mut m = lock(&self.timer);
                let due = m.overtime_due(now, t.overtime_after.as_secs());
                if due {
                    m.overtime_prompted = true;
                }
                let over = m.break_over_limit(now);
                if over && let Some(b) = m.break_info.as_mut() {
                    b.warned = true;
                }
                (due, over.then(|| m.break_info.clone()).flatten())
            };
            if overtime_due {
                if self.silent() {
                    let c = self.clone();
                    tokio::spawn(async move {
                        let _ = c.overtime_decision(true).await;
                    });
                } else {
                    let hours = t.overtime_after.as_secs() / 3600;
                    self.ui.prompt(events::OVERTIME_PROMPT, serde_json::json!({}));
                    self.ui.show_window();
                    self.ui.notify("Overtime?", &format!("You've worked {hours} hours today. Continue as overtime?"));
                }
            }
            if let Some(b) = break_over {
                let mins = b.limit_secs.unwrap_or(0) / 60;
                let msg = format!("Your {} break has passed its {mins}-minute limit.", b.reason_text);
                self.ui.toast(ToastKind::Warning, msg.clone());
                self.ui.notify("Break limit reached", &msg);
            }

            // Idle rules.
            let sys_idle = idle::system_idle_secs();
            if let Some(idle_secs) = sys_idle
                && !self.idle_busy.load(Ordering::Relaxed)
            {
                let action = match snap.state {
                    TimerState::Working if idle_secs >= t.idle_after.as_secs() => Some(0u8),
                    TimerState::Idle if idle_secs >= t.idle_autostop.as_secs() => Some(2),
                    TimerState::Idle if idle_secs < t.idle_after.as_secs() => {
                        let mut last = lock(&self.last_resume_attempt);
                        if last.is_none_or(|l| now.duration_since(l) > Duration::from_secs(30)) {
                            *last = Some(now);
                            Some(1)
                        } else {
                            None
                        }
                    }
                    _ => None,
                };
                if let Some(a) = action {
                    self.idle_busy.store(true, Ordering::Relaxed);
                    let c = self.clone();
                    tokio::spawn(async move {
                        match a {
                            0 => c.go_idle(idle_secs).await,
                            1 => c.auto_resume().await,
                            _ => c.auto_stop_idle().await,
                        }
                        c.idle_busy.store(false, Ordering::Relaxed);
                    });
                }
            }
            if snap.state != TimerState::Idle {
                *lock(&self.last_resume_attempt) = None;
            }

            // Tracking only while working and unlocked.
            let tracking = snap.state == TimerState::Working && !self.locked.load(Ordering::Relaxed);
            if !tracking {
                if let Some(s) = lock(&self.track).schedule.as_mut() {
                    s.skip_current(now, &mut next);
                }
                continue;
            }
            if now.duration_since(last_sample) >= t.activity_sample {
                last_sample = now;
                if let Some(i) = sys_idle {
                    lock(&self.track).sampler.record(i, t.activity_sample.as_secs());
                }
            }
            if now.duration_since(last_app_poll) >= t.app_poll {
                last_app_poll = now;
                let c = self.clone();
                tokio::spawn(async move {
                    c.observe_window().await;
                });
            }
            if now.duration_since(last_flush) >= t.app_flush {
                last_flush = now;
                if let Some((items, _)) = self.drain_usage_payload()
                    && let Err(e) = self.queue.enqueue(Job::AppUsage { items }, None)
                {
                    log::warn!("queue app usage: {e}");
                }
            }
            let due = lock(&self.track).schedule.as_mut().is_some_and(|s| s.due(now, &mut next));
            if due {
                let c = self.clone();
                tokio::spawn(async move { c.capture_screenshot().await });
            }
        }
    }

    /// Quit / shutdown: stop a running timer (best effort) so the server log closes now.
    pub async fn shutdown(&self) {
        if self.is_running()
            && let Err(e) = self.stop_timer_inner(true).await
        {
            log::warn!("stop on quit: {e}");
        }
    }
}
