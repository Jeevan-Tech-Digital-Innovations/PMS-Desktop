//! PMS-API client (docs/ARCHITECTURE.md section 3). JSON is camelCase; the bearer token never leaves Rust.
//! A 401 triggers one token refresh and one retry.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use chrono::{DateTime, Local};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::auth::Auth;
use crate::config;
use crate::error::{AppError, AppResult};
use crate::time;
use crate::types::BreakReason;

pub fn build_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(config::user_agent())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(45))
        .build()
        .expect("HTTP client")
}

/// `TaskTimeLogResponse` (subset).
#[derive(Debug, Clone, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimeLog {
    #[serde(default)]
    pub id: Option<i64>,
    #[serde(default)]
    pub task_id: Option<i64>,
    #[serde(default)]
    pub task_name: Option<String>,
    #[serde(default)]
    pub project_id: Option<i64>,
    #[serde(default)]
    pub project_name: Option<String>,
    #[serde(default)]
    pub start_time: Option<String>,
    #[serde(default)]
    pub end_time: Option<String>,
    #[serde(default)]
    pub time_type: Option<String>,
    #[serde(default)]
    pub accumulated_seconds_today: Option<i64>,
}

/// Server timer states for `/time-logs/transition`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServerState {
    ActiveProductive,
    ProductivePause,
    Away,
    Idle,
    Overtime,
}

impl ServerState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ActiveProductive => "ACTIVE_PRODUCTIVE",
            Self::ProductivePause => "PRODUCTIVE_PAUSE",
            Self::Away => "AWAY",
            Self::Idle => "IDLE",
            Self::Overtime => "OVERTIME",
        }
    }
}

/// Unwrap the common `{status, data: …}` envelope.
pub fn unwrap_data(v: Value) -> Value {
    match v {
        Value::Object(mut m) if m.contains_key("data") => m.remove("data").unwrap_or(Value::Null),
        other => other,
    }
}

/// A list from a bare array, `{data: [...]}`, `{content: [...]}` (Spring page) or `{data: {content: [...]}}`.
pub fn as_list(v: Value) -> Vec<Value> {
    match unwrap_data(v) {
        Value::Array(a) => a,
        Value::Object(mut m) => match m.remove("content") {
            Some(Value::Array(a)) => a,
            _ => Vec::new(),
        },
        _ => Vec::new(),
    }
}

fn parse_body(text: &str) -> AppResult<Option<Value>> {
    let t = text.trim();
    if t.is_empty() || t == "null" {
        return Ok(None);
    }
    serde_json::from_str(t).map(Some).map_err(|_| AppError::server("Unexpected response from PMS."))
}

fn as_u64(v: Option<Value>) -> u64 {
    match v.map(unwrap_data) {
        Some(Value::Number(n)) => n.as_f64().map(|f| f.max(0.0) as u64).unwrap_or(0),
        Some(Value::String(s)) => s.trim().parse::<f64>().map(|f| f.max(0.0) as u64).unwrap_or(0),
        _ => 0,
    }
}

fn timezone_name() -> String {
    iana_time_zone::get_timezone().unwrap_or_default()
}

pub struct Api {
    http: reqwest::Client,
    base: String,
    auth: Arc<Auth>,
    online: AtomicBool,
}

impl Api {
    pub fn new(http: reqwest::Client, base: String, auth: Arc<Auth>) -> Self {
        Self { http, base, auth, online: AtomicBool::new(true) }
    }

    pub fn is_online(&self) -> bool {
        self.online.load(Ordering::Relaxed)
    }

    pub fn auth(&self) -> &Arc<Auth> {
        &self.auth
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base, path)
    }

    async fn once<F>(&self, build: &F, token: &str) -> AppResult<(u16, String)>
    where
        F: Fn(&reqwest::Client) -> reqwest::RequestBuilder,
    {
        let res = build(&self.http).bearer_auth(token).send().await;
        match res {
            Ok(resp) => {
                self.online.store(true, Ordering::Relaxed);
                let status = resp.status().as_u16();
                let text = resp.text().await.unwrap_or_default();
                Ok((status, text))
            }
            Err(e) => {
                let err = AppError::from(e);
                if err.code == crate::error::ErrorCode::Offline {
                    self.online.store(false, Ordering::Relaxed);
                }
                Err(err)
            }
        }
    }

    /// Send with auth, refreshing once on 401. Returns the raw body of a 2xx response.
    pub async fn send<F>(&self, build: F) -> AppResult<String>
    where
        F: Fn(&reqwest::Client) -> reqwest::RequestBuilder,
    {
        let (token, generation) = self.auth.access_token().await?;
        let (mut status, mut text) = self.once(&build, &token).await?;
        if status == 401 {
            self.auth.refresh(generation).await?;
            let (token, _) = self.auth.access_token().await?;
            (status, text) = self.once(&build, &token).await?;
        }
        if (200..300).contains(&status) {
            Ok(text)
        } else {
            Err(AppError::from_status(status, &text))
        }
    }

    async fn get(&self, path: &str) -> AppResult<Option<Value>> {
        let url = self.url(path);
        parse_body(&self.send(|c| c.get(&url)).await?)
    }

    async fn post(&self, path: &str, body: Option<Value>) -> AppResult<Option<Value>> {
        let url = self.url(path);
        let text = self
            .send(|c| {
                let r = c.post(&url);
                match &body {
                    Some(b) => r.json(b),
                    None => r,
                }
            })
            .await?;
        parse_body(&text)
    }

    async fn put(&self, path: &str, body: Option<Value>) -> AppResult<Option<Value>> {
        let url = self.url(path);
        let text = self
            .send(|c| {
                let r = c.put(&url);
                match &body {
                    Some(b) => r.json(b),
                    None => r,
                }
            })
            .await?;
        parse_body(&text)
    }

    fn time_log(v: Option<Value>) -> AppResult<TimeLog> {
        let v = v.map(unwrap_data).ok_or_else(|| AppError::server("Empty time log response."))?;
        serde_json::from_value(v).map_err(|_| AppError::server("Unexpected time log response."))
    }

    // ── Profile / catalogue ──

    pub async fn employee_me(&self) -> AppResult<Value> {
        Ok(self.get("/employees/me").await?.map(unwrap_data).unwrap_or(Value::Null))
    }

    pub async fn projects(&self) -> AppResult<Vec<Value>> {
        Ok(self.get("/projects?assignedOnly=true&includeStats=false").await?.map(as_list).unwrap_or_default())
    }

    /// Top-level tasks of a project with `subTasks` populated recursively by the API.
    pub async fn project_tasks(&self, project_id: i64) -> AppResult<Vec<Value>> {
        Ok(self.get(&format!("/projects/{project_id}/tasks?page=1&size=500")).await?.map(as_list).unwrap_or_default())
    }

    pub async fn subtasks(&self, task_id: i64) -> AppResult<Vec<Value>> {
        Ok(self.get(&format!("/tasks/{task_id}/subtasks")).await?.map(as_list).unwrap_or_default())
    }

    // ── Time logs ──

    pub async fn start(&self, task_id: i64) -> AppResult<TimeLog> {
        let url = self.url(&format!("/tasks/{task_id}/time-logs/start"));
        let tz = timezone_name();
        let text = self
            .send(|c| {
                let r = c.post(&url).json(&json!([]));
                if tz.is_empty() { r } else { r.header("Timezone", &tz) }
            })
            .await?;
        Self::time_log(parse_body(&text)?)
    }

    pub async fn end(&self, task_id: i64) -> AppResult<()> {
        self.put(&format!("/tasks/{task_id}/time-logs/end"), None).await.map(|_| ())
    }

    pub async fn transition(&self, task_id: i64, state: ServerState, effective: DateTime<Local>) -> AppResult<TimeLog> {
        let body = json!({ "newState": state.as_str(), "effectiveTime": time::api_ts(&effective) });
        Self::time_log(self.post(&format!("/tasks/{task_id}/time-logs/transition"), Some(body)).await?)
    }

    /// `None` when no timer runs (the API answers 200 with an empty body).
    pub async fn active(&self) -> AppResult<Option<TimeLog>> {
        match self.get("/tasks/time-logs/active").await?.map(unwrap_data) {
            None | Some(Value::Null) => Ok(None),
            Some(v) => {
                let log: TimeLog = serde_json::from_value(v).map_err(|_| AppError::server("Unexpected active timer response."))?;
                Ok(if log.id.is_some() && log.end_time.is_none() { Some(log) } else { None })
            }
        }
    }

    pub async fn accumulated_today(&self) -> AppResult<u64> {
        Ok(as_u64(self.get("/tasks/time-logs/accumulated-today").await?))
    }

    pub async fn accumulated_break_today(&self) -> AppResult<u64> {
        Ok(as_u64(self.get("/tasks/time-logs/accumulated-break-today").await?))
    }

    pub async fn task_accumulated_today(&self, task_id: i64) -> AppResult<u64> {
        Ok(as_u64(self.get(&format!("/tasks/{task_id}/time-logs/accumulated-today")).await?))
    }

    pub async fn time_logs(&self) -> AppResult<Vec<TimeLog>> {
        let list = self.get("/tasks/time-logs").await?.map(as_list).unwrap_or_default();
        Ok(list.into_iter().filter_map(|v| serde_json::from_value(v).ok()).collect())
    }

    pub async fn heartbeat(&self, time_log_id: i64) -> AppResult<()> {
        self.put(&format!("/tasks/time-logs/{time_log_id}/heartbeat"), None).await.map(|_| ())
    }

    // ── Breaks / notes ──

    pub async fn break_reasons(&self) -> AppResult<Vec<BreakReason>> {
        let list = self.get("/breaks/reasons").await?.map(as_list).unwrap_or_default();
        Ok(list
            .into_iter()
            .filter_map(|v| {
                let id = match v.get("id")? {
                    Value::String(s) => s.clone(),
                    other => other.to_string(),
                };
                let reason_text = v.get("reasonText")?.as_str()?.to_string();
                let duration_limit_minutes =
                    v.get("durationLimitMinutes").and_then(Value::as_u64).filter(|m| *m > 0).map(|m| m as u32);
                Some(BreakReason { id, reason_text, duration_limit_minutes })
            })
            .collect())
    }

    pub async fn break_start(&self, time_log_id: i64, reason_id: &str) -> AppResult<()> {
        let body = json!({ "breakReasonId": reason_id });
        self.post(&format!("/tasks/time-logs/{time_log_id}/breaks/start"), Some(body)).await.map(|_| ())
    }

    pub async fn break_stop(&self, time_log_id: i64) -> AppResult<()> {
        self.put(&format!("/tasks/time-logs/{time_log_id}/breaks/stop"), None).await.map(|_| ())
    }

    pub async fn add_note(&self, time_log_id: i64, text: &str) -> AppResult<()> {
        let body = json!({ "noteText": text });
        self.post(&format!("/tasks/time-logs/{time_log_id}/notes"), Some(body)).await.map(|_| ())
    }

    // ── Tracking uploads ──

    pub async fn upload_screenshot(
        &self,
        time_log_id: i64,
        jpeg: Vec<u8>,
        captured_at: &str,
        activity_percent: u8,
        active_window_title: &str,
    ) -> AppResult<()> {
        let url = self.url(&format!("/screenshots/upload/{time_log_id}"));
        let file_name = format!("screenshot_{time_log_id}_{}.jpg", chrono::Utc::now().timestamp_millis());
        let pct = activity_percent.to_string();
        self.send(|c| {
            let part = reqwest::multipart::Part::bytes(jpeg.clone())
                .file_name(file_name.clone())
                .mime_str("image/jpeg")
                .expect("static mime");
            let form = reqwest::multipart::Form::new()
                .part("file", part)
                .text("capturedAt", captured_at.to_string())
                .text("keyboardActivityPercent", pct.clone())
                .text("mouseActivityPercent", pct.clone())
                .text("activeWindowTitle", active_window_title.to_string());
            c.post(&url).multipart(form)
        })
        .await
        .map(|_| ())
    }

    pub async fn app_usage(&self, items: &Value) -> AppResult<()> {
        self.post("/activity/apps/bulk", Some(items.clone())).await.map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn envelopes() {
        assert_eq!(as_list(json!([1, 2])).len(), 2);
        assert_eq!(as_list(json!({"data": [1]})).len(), 1);
        assert_eq!(as_list(json!({"content": [1, 2, 3], "totalElements": 3})).len(), 3);
        assert_eq!(as_list(json!({"data": {"content": [1]}})).len(), 1);
        assert_eq!(unwrap_data(json!({"status": "success", "data": {"a": 1}})), json!({"a": 1}));
        assert!(parse_body("").unwrap().is_none());
        assert!(parse_body("  ").unwrap().is_none());
        assert_eq!(as_u64(Some(json!(42))), 42);
        assert_eq!(as_u64(Some(json!({"data": 7}))), 7);
        assert_eq!(as_u64(None), 0);
    }

    #[test]
    fn parses_time_log() {
        let v = json!({"id": 9, "taskId": 3, "taskName": "T", "projectId": 1, "startTime": "2026-11-14T10:00:00",
                       "endTime": null, "timeType": "ACTIVE_PRODUCTIVE"});
        let log = Api::time_log(Some(v)).unwrap();
        assert_eq!(log.id, Some(9));
        assert_eq!(log.time_type.as_deref(), Some("ACTIVE_PRODUCTIVE"));
    }
}
