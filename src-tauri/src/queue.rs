//! Offline queue for screenshots and app-usage batches (docs/ARCHITECTURE.md section 7).
//!
//! Every item is written to `<app data>/queue/` first and then sent by one worker, oldest first.
//! Retryable failures back off 5 s → 10 s → … → 5 min; items older than 7 days or beyond 500 MB in total
//! are dropped (oldest first). Heartbeats are never queued.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::api::Api;
use crate::error::{AppResult, ErrorCode};

pub const MAX_BYTES: u64 = 500 * 1024 * 1024;
pub const MAX_AGE: Duration = Duration::from_secs(7 * 24 * 3600);
const BACKOFF_MIN: u64 = 5;
const BACKOFF_MAX: u64 = 300;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Job {
    #[serde(rename_all = "camelCase")]
    Screenshot { time_log_id: i64, captured_at: String, activity_percent: u8, active_window_title: String },
    #[serde(rename_all = "camelCase")]
    AppUsage { items: Value },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Meta {
    created_at: i64,
    job: Job,
}

/// Seconds to wait after `failures` consecutive retryable failures (`failures >= 1`).
pub fn backoff_secs(failures: u32) -> u64 {
    let exp = failures.saturating_sub(1).min(16);
    (BACKOFF_MIN.saturating_mul(1u64 << exp)).min(BACKOFF_MAX)
}

#[derive(Debug, Clone, PartialEq)]
pub struct ItemInfo {
    pub stem: String,
    pub created_at: i64,
    pub bytes: u64,
}

/// Which items to delete: everything older than `max_age`, then the oldest until the total fits `max_bytes`.
/// `items` must be sorted oldest first.
pub fn prune_plan(items: &[ItemInfo], now: i64, max_age: Duration, max_bytes: u64) -> Vec<String> {
    let mut out = Vec::new();
    let mut kept: Vec<&ItemInfo> = Vec::new();
    for it in items {
        if now - it.created_at > max_age.as_secs() as i64 {
            out.push(it.stem.clone());
        } else {
            kept.push(it);
        }
    }
    let mut total: u64 = kept.iter().map(|i| i.bytes).sum();
    for it in kept {
        if total <= max_bytes {
            break;
        }
        total -= it.bytes;
        out.push(it.stem.clone());
    }
    out
}

pub struct Queue {
    dir: PathBuf,
    count: AtomicUsize,
    wake: tokio::sync::Notify,
}

impl Queue {
    pub fn new(dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&dir);
        let q = Self { dir, count: AtomicUsize::new(0), wake: tokio::sync::Notify::new() };
        q.recount();
        q
    }

    pub fn len(&self) -> usize {
        self.count.load(Ordering::Relaxed)
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    fn recount(&self) {
        self.count.store(self.list().len(), Ordering::Relaxed);
    }

    fn meta_path(&self, stem: &str) -> PathBuf {
        self.dir.join(format!("{stem}.json"))
    }

    fn blob_path(&self, stem: &str) -> PathBuf {
        self.dir.join(format!("{stem}.jpg"))
    }

    fn new_stem() -> String {
        format!("{:014}-{}", chrono::Utc::now().timestamp_millis(), uuid::Uuid::new_v4().simple())
    }

    fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
        let tmp = path.with_extension("tmp");
        std::fs::write(&tmp, bytes)?;
        std::fs::rename(&tmp, path)
    }

    pub fn enqueue(&self, job: Job, blob: Option<&[u8]>) -> std::io::Result<()> {
        std::fs::create_dir_all(&self.dir)?;
        let stem = Self::new_stem();
        if let Some(b) = blob {
            Self::write_atomic(&self.blob_path(&stem), b)?;
        }
        let meta = Meta { created_at: chrono::Utc::now().timestamp(), job };
        let json = serde_json::to_vec(&meta).map_err(std::io::Error::other)?;
        Self::write_atomic(&self.meta_path(&stem), &json)?;
        self.count.fetch_add(1, Ordering::Relaxed);
        self.wake.notify_one();
        Ok(())
    }

    /// Items oldest first.
    pub fn list(&self) -> Vec<ItemInfo> {
        let Ok(rd) = std::fs::read_dir(&self.dir) else { return Vec::new() };
        let mut out: Vec<ItemInfo> = rd
            .filter_map(Result::ok)
            .filter_map(|e| {
                let p = e.path();
                if p.extension()? != "json" {
                    return None;
                }
                let stem = p.file_stem()?.to_str()?.to_string();
                let created_ms: i64 = stem.split('-').next()?.parse().ok()?;
                let mut bytes = e.metadata().map(|m| m.len()).unwrap_or(0);
                if let Ok(m) = std::fs::metadata(self.blob_path(&stem)) {
                    bytes += m.len();
                }
                Some(ItemInfo { stem, created_at: created_ms / 1000, bytes })
            })
            .collect();
        out.sort_by(|a, b| a.stem.cmp(&b.stem));
        out
    }

    fn remove(&self, stem: &str) {
        let _ = std::fs::remove_file(self.meta_path(stem));
        let _ = std::fs::remove_file(self.blob_path(stem));
    }

    pub fn prune(&self) -> usize {
        let plan = prune_plan(&self.list(), chrono::Utc::now().timestamp(), MAX_AGE, MAX_BYTES);
        for stem in &plan {
            log::warn!("offline queue: dropping {stem} (age/size cap)");
            self.remove(stem);
        }
        self.recount();
        plan.len()
    }

    async fn send(&self, api: &Api, stem: &str) -> AppResult<()> {
        let raw = match std::fs::read(self.meta_path(stem)) {
            Ok(r) => r,
            Err(_) => return Ok(()), // vanished: treat as done
        };
        let Ok(meta) = serde_json::from_slice::<Meta>(&raw) else {
            log::warn!("offline queue: corrupt item {stem} removed");
            return Ok(());
        };
        match meta.job {
            Job::Screenshot { time_log_id, captured_at, activity_percent, active_window_title } => {
                let Ok(jpeg) = std::fs::read(self.blob_path(stem)) else { return Ok(()) };
                api.upload_screenshot(time_log_id, jpeg, &captured_at, activity_percent, &active_window_title).await.map(|_| ())
            }
            Job::AppUsage { items } => api.app_usage(&items).await.map(|_| ()),
        }
    }

    /// One pass over every queued item (debug end-to-end check). Returns `(sent, still_queued)`.
    #[cfg(debug_assertions)]
    pub async fn drain_once(&self, api: &Api) -> (usize, usize) {
        let mut sent = 0;
        for item in self.list() {
            match self.send(api, &item.stem).await {
                Ok(()) => {
                    self.remove(&item.stem);
                    sent += 1;
                }
                Err(e) if e.is_retryable() || e.code == ErrorCode::Unauthorized => {
                    log::info!("offline queue: {} kept ({e})", item.stem);
                }
                Err(e) => {
                    log::warn!("offline queue: item {} rejected ({e}); dropped", item.stem);
                    self.remove(&item.stem);
                }
            }
        }
        self.recount();
        (sent, self.len())
    }

    /// Worker: runs forever. Call once.
    pub async fn run(self: Arc<Self>, api: Arc<Api>) {
        let mut failures: u32 = 0;
        let mut last_prune = std::time::Instant::now() - Duration::from_secs(3600);
        loop {
            if last_prune.elapsed() > Duration::from_secs(60) {
                self.prune();
                last_prune = std::time::Instant::now();
            }
            let Some(item) = self.list().into_iter().next() else {
                self.count.store(0, Ordering::Relaxed);
                let _ = tokio::time::timeout(Duration::from_secs(30), self.wake.notified()).await;
                continue;
            };
            if !api.auth().is_signed_in() {
                let _ = tokio::time::timeout(Duration::from_secs(15), self.wake.notified()).await;
                continue;
            }
            match self.send(&api, &item.stem).await {
                Ok(()) => {
                    failures = 0;
                    self.remove(&item.stem);
                    self.recount();
                }
                Err(e) if e.is_retryable() || e.code == ErrorCode::Unauthorized => {
                    failures = failures.saturating_add(1);
                    let wait = backoff_secs(failures);
                    log::info!("offline queue: send failed ({e}); retry in {wait}s");
                    tokio::time::sleep(Duration::from_secs(wait)).await;
                }
                Err(e) => {
                    log::warn!("offline queue: item {} rejected ({e}); dropped", item.stem);
                    failures = 0;
                    self.remove(&item.stem);
                    self.recount();
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_doubles_and_caps() {
        assert_eq!(backoff_secs(1), 5);
        assert_eq!(backoff_secs(2), 10);
        assert_eq!(backoff_secs(3), 20);
        assert_eq!(backoff_secs(6), 160);
        assert_eq!(backoff_secs(7), 300);
        assert_eq!(backoff_secs(100), 300);
        assert_eq!(backoff_secs(0), 5);
    }

    fn item(stem: &str, created_at: i64, bytes: u64) -> ItemInfo {
        ItemInfo { stem: stem.into(), created_at, bytes }
    }

    #[test]
    fn prune_drops_old_then_oldest_over_cap() {
        let now = 10 * 24 * 3600;
        let day = 24 * 3600;
        let items = vec![
            item("a", now - 8 * day, 10), // too old
            item("b", now - 3 * day, 60),
            item("c", now - 2 * day, 30),
            item("d", now - day, 30),
        ];
        // 7-day cap removes "a"; then 120 bytes > 100 cap → drop "b" (oldest) → 60 fits.
        assert_eq!(prune_plan(&items, now, MAX_AGE, 100), vec!["a", "b"]);
        assert_eq!(prune_plan(&items, now, MAX_AGE, 1000), vec!["a"]);
        assert!(prune_plan(&items[1..], now, MAX_AGE, 1000).is_empty());
    }

    #[test]
    fn enqueue_list_and_prune_on_disk() {
        let dir = std::env::temp_dir().join(format!("pms-queue-test-{}", uuid::Uuid::new_v4().simple()));
        let q = Queue::new(dir.clone());
        assert!(q.is_empty());
        q.enqueue(Job::AppUsage { items: serde_json::json!([{"appName": "Google Chrome"}]) }, None).unwrap();
        q.enqueue(
            Job::Screenshot {
                time_log_id: 1,
                captured_at: "2026-11-14T10:00:00+05:30".into(),
                activity_percent: 50,
                active_window_title: "x".into(),
            },
            Some(&[1, 2, 3]),
        )
        .unwrap();
        assert_eq!(q.len(), 2);
        let items = q.list();
        assert_eq!(items.len(), 2);
        assert!(items[0].stem < items[1].stem);
        assert!(items[1].bytes > 3);
        assert_eq!(q.prune(), 0);
        q.remove(&items[0].stem);
        q.recount();
        assert_eq!(q.len(), 1);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn job_json_roundtrip() {
        let j = Job::Screenshot { time_log_id: 7, captured_at: "t".into(), activity_percent: 9, active_window_title: "w".into() };
        let s = serde_json::to_string(&j).unwrap();
        assert!(s.contains("\"kind\":\"screenshot\"") && s.contains("\"timeLogId\":7"));
        assert_eq!(serde_json::from_str::<Job>(&s).unwrap(), j);
    }
}
