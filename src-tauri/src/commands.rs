//! Every `#[tauri::command]` from docs/ARCHITECTURE.md section 4. Thin wrappers over `Core`.
//! Argument names are snake_case here; Tauri exposes them camelCase (`projectId`, `continueOvertime`, …).

use std::sync::Arc;

use tauri::State;

use crate::app::Core;
use crate::error::AppResult;
use crate::types::*;

type CoreState<'a> = State<'a, Arc<Core>>;

#[tauri::command]
pub async fn get_session(core: CoreState<'_>) -> AppResult<Option<Session>> {
    Ok(core.session().await)
}

#[tauri::command]
pub async fn sign_in(core: CoreState<'_>, email: String, password: String) -> AppResult<Session> {
    core.sign_in(&email, &password).await
}

#[tauri::command]
pub async fn sign_out(core: CoreState<'_>) -> AppResult<()> {
    core.sign_out().await
}

#[tauri::command]
pub async fn accept_first_run_notice(core: CoreState<'_>) -> AppResult<()> {
    core.accept_first_run_notice()
}

#[tauri::command]
pub async fn switch_company(core: CoreState<'_>, tenant_id: String) -> AppResult<Session> {
    core.switch_company(&tenant_id).await
}

#[tauri::command]
pub async fn list_projects(core: CoreState<'_>) -> AppResult<Vec<Project>> {
    core.list_projects().await
}

#[tauri::command]
pub async fn list_tasks(core: CoreState<'_>, project_id: i64) -> AppResult<Vec<TaskNode>> {
    core.list_tasks(project_id).await
}

#[tauri::command]
pub async fn list_subtasks(core: CoreState<'_>, task_id: i64) -> AppResult<Vec<TaskNode>> {
    core.list_subtasks(task_id).await
}

#[tauri::command]
pub async fn search_tasks(core: CoreState<'_>, query: String) -> AppResult<Vec<TaskRef>> {
    core.search_tasks(&query).await
}

#[tauri::command]
pub async fn recent_tasks(core: CoreState<'_>) -> AppResult<Vec<TaskRef>> {
    core.recent_tasks().await
}

#[tauri::command]
pub async fn get_timer(core: CoreState<'_>) -> AppResult<TimerSnapshot> {
    Ok(core.snapshot())
}

#[tauri::command]
pub async fn start_timer(core: CoreState<'_>, task: TaskRef) -> AppResult<TimerSnapshot> {
    core.start_timer(task).await
}

#[tauri::command]
pub async fn pause_timer(core: CoreState<'_>) -> AppResult<TimerSnapshot> {
    core.pause_timer().await
}

#[tauri::command]
pub async fn resume_timer(core: CoreState<'_>) -> AppResult<TimerSnapshot> {
    core.resume_timer().await
}

#[tauri::command]
pub async fn away_timer(core: CoreState<'_>) -> AppResult<TimerSnapshot> {
    core.away_timer().await
}

#[tauri::command]
pub async fn stop_timer(core: CoreState<'_>) -> AppResult<TimerSnapshot> {
    core.stop_timer().await
}

#[tauri::command]
pub async fn list_break_reasons(core: CoreState<'_>) -> AppResult<Vec<BreakReason>> {
    core.list_break_reasons().await
}

#[tauri::command]
pub async fn start_break(core: CoreState<'_>, reason_id: String) -> AppResult<TimerSnapshot> {
    core.start_break(&reason_id).await
}

#[tauri::command]
pub async fn end_break(core: CoreState<'_>) -> AppResult<TimerSnapshot> {
    core.end_break().await
}

#[tauri::command]
pub async fn submit_idle_note(core: CoreState<'_>, text: String) -> AppResult<()> {
    core.submit_idle_note(&text).await
}

#[tauri::command]
pub async fn overtime_decision(core: CoreState<'_>, continue_overtime: bool) -> AppResult<TimerSnapshot> {
    core.overtime_decision(continue_overtime).await
}

#[tauri::command]
pub async fn open_pms_web(app: tauri::AppHandle, core: CoreState<'_>) -> AppResult<()> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(core.cfg.web_url.clone(), None::<&str>)
        .map_err(|e| crate::error::AppError::server(e.to_string()))
}

#[tauri::command]
pub async fn app_info(core: CoreState<'_>) -> AppResult<AppInfo> {
    Ok(AppInfo {
        version: crate::config::VERSION.to_string(),
        platform: crate::config::platform().to_string(),
        api_url: core.cfg.api_url.clone(),
        dev: core.cfg.dev,
        linux_session: crate::config::linux_session().map(str::to_string),
    })
}
