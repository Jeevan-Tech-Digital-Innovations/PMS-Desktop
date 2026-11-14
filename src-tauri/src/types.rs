//! Types shared with the React screen (docs/ARCHITECTURE.md sections 4 and 5). camelCase on the wire;
//! optional TS fields (`foo?: T`) are skipped when `None` so they arrive as `undefined`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionUser {
    pub id: String,
    pub email: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Company {
    pub tenant_id: String,
    pub name: String,
    pub status: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TrackingMode {
    Visible,
    Silent,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub user: SessionUser,
    pub companies: Vec<Company>,
    pub active_tenant_id: String,
    pub tracking_mode: TrackingMode,
    pub first_run_notice_accepted: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: i64,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskNode {
    pub id: i64,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    pub has_children: bool,
}

/// `path` = breadcrumb titles from the top-level task down to and including this task (project excluded).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskRef {
    pub task_id: i64,
    pub title: String,
    pub project_id: i64,
    pub project_name: String,
    #[serde(default)]
    pub path: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BreakReason {
    pub id: String,
    pub reason_text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_limit_minutes: Option<u32>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TimerState {
    Stopped,
    Working,
    Paused,
    Away,
    Break,
    Idle,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BreakInfoDto {
    pub reason_text: String,
    pub limit_seconds: Option<u64>,
    pub started_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimerSnapshot {
    pub state: TimerState,
    pub time_log_id: Option<i64>,
    pub task: Option<TaskRef>,
    pub started_at: Option<String>,
    pub elapsed_seconds: u64,
    pub today_work_seconds: u64,
    pub today_break_seconds: u64,
    pub overtime: bool,
    pub break_info: Option<BreakInfoDto>,
    pub queued: usize,
    pub online: bool,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum IdleNoteMode {
    Off,
    Optional,
    Mandatory,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdleStarted {
    pub idle_seconds: u64,
    pub note: IdleNoteMode,
}

#[derive(Debug, Clone, Serialize)]
pub struct IdleEnded {
    pub resumed: bool,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ToastKind {
    Info,
    Success,
    Warning,
    Error,
}

#[derive(Debug, Clone, Serialize)]
pub struct Toast {
    pub kind: ToastKind,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Navigate {
    pub to: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub platform: String,
    pub api_url: String,
    pub dev: bool,
}

pub mod events {
    pub const TIMER_CHANGED: &str = "timer:changed";
    pub const SESSION_CHANGED: &str = "session:changed";
    pub const IDLE_STARTED: &str = "idle:started";
    pub const IDLE_ENDED: &str = "idle:ended";
    pub const OVERTIME_PROMPT: &str = "overtime:prompt";
    pub const TOAST: &str = "toast";
    pub const NAVIGATE: &str = "navigate";
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contract_field_names() {
        let p = Project { id: 1, name: "P".into(), client_name: None };
        assert_eq!(serde_json::to_string(&p).unwrap(), r#"{"id":1,"name":"P"}"#);
        let t: TaskRef = serde_json::from_str(
            r#"{"taskId":5,"title":"T","projectId":1,"projectName":"P","path":["A","T"]}"#,
        )
        .unwrap();
        assert_eq!(t.task_id, 5);
        let n = TaskNode { id: 1, title: "x".into(), status: None, has_children: true };
        assert!(serde_json::to_string(&n).unwrap().contains("\"hasChildren\":true"));
        assert_eq!(serde_json::to_string(&TimerState::Break).unwrap(), "\"break\"");
        assert_eq!(
            serde_json::to_string(&IdleStarted { idle_seconds: 300, note: IdleNoteMode::Optional }).unwrap(),
            r#"{"idleSeconds":300,"note":"optional"}"#
        );
    }
}
