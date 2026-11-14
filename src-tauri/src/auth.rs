//! Axis identity: mobile login / refresh / logout, company switch, keychain (docs/ARCHITECTURE.md section 2).
//!
//! Axis JSON is snake_case. The access token lives only in memory; the refresh token and the device id
//! live in the OS keychain. The refresh token rotates, so only one refresh is ever in flight.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Deserializer};
use serde_json::json;

use crate::config::{self, KEYCHAIN_SERVICE};
use crate::error::{AppError, AppResult};

const REFRESH_KEY: &str = "refresh_token";
const DEVICE_KEY: &str = "device_id";
/// Refresh this long before the access token expires.
const REFRESH_MARGIN: Duration = Duration::from_secs(60);

// ── Secret storage ───────────────────────────────────────────────────────────

pub trait SecretStore: Send + Sync {
    fn get(&self, key: &str) -> Option<String>;
    fn set(&self, key: &str, value: &str) -> bool;
    fn delete(&self, key: &str);
}

/// OS keychain (Windows Credential Manager / macOS Keychain).
pub struct KeychainStore;

impl SecretStore for KeychainStore {
    fn get(&self, key: &str) -> Option<String> {
        let entry = keyring::Entry::new(KEYCHAIN_SERVICE, key).ok()?;
        match entry.get_password() {
            Ok(v) if !v.is_empty() => Some(v),
            Ok(_) | Err(keyring::Error::NoEntry) => None,
            Err(e) => {
                log::warn!("keychain read failed for {key}: {e}");
                None
            }
        }
    }
    fn set(&self, key: &str, value: &str) -> bool {
        match keyring::Entry::new(KEYCHAIN_SERVICE, key).and_then(|e| e.set_password(value)) {
            Ok(()) => true,
            Err(e) => {
                log::warn!("keychain write failed for {key}: {e}");
                false
            }
        }
    }
    fn delete(&self, key: &str) {
        if let Ok(e) = keyring::Entry::new(KEYCHAIN_SERVICE, key) {
            let _ = e.delete_credential();
        }
    }
}

/// In-memory store (self-test and unit tests: never touches the real keychain).
#[derive(Default)]
pub struct MemoryStore(Mutex<HashMap<String, String>>);

impl SecretStore for MemoryStore {
    fn get(&self, key: &str) -> Option<String> {
        self.0.lock().ok()?.get(key).cloned()
    }
    fn set(&self, key: &str, value: &str) -> bool {
        if let Ok(mut m) = self.0.lock() {
            m.insert(key.into(), value.into());
        }
        true
    }
    fn delete(&self, key: &str) {
        if let Ok(mut m) = self.0.lock() {
            m.remove(key);
        }
    }
}

// ── Axis payloads ────────────────────────────────────────────────────────────

fn de_string<'de, D: Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    let v = serde_json::Value::deserialize(d)?;
    Ok(match v {
        serde_json::Value::String(s) => s,
        serde_json::Value::Null => String::new(),
        other => other.to_string(),
    })
}

fn de_opt_string<'de, D: Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    let s = de_string(d)?;
    Ok(if s.is_empty() { None } else { Some(s) })
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct AxisUser {
    #[serde(default, deserialize_with = "de_string")]
    pub id: String,
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub first_name: Option<String>,
    #[serde(default)]
    pub last_name: Option<String>,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub avatar_url: Option<String>,
}

impl AxisUser {
    pub fn best_display_name(&self) -> String {
        if let Some(d) = self.display_name.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
            return d.to_string();
        }
        let full = format!(
            "{} {}",
            self.first_name.as_deref().unwrap_or("").trim(),
            self.last_name.as_deref().unwrap_or("").trim()
        );
        let full = full.trim();
        if full.is_empty() { self.email.clone() } else { full.to_string() }
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Membership {
    #[serde(default, deserialize_with = "de_string")]
    pub tenant_id: String,
    #[serde(default)]
    pub tenant_name: Option<String>,
    #[serde(default)]
    pub slug: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct AuthResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    expires_in: Option<i64>,
    #[serde(default, deserialize_with = "de_opt_string")]
    active_tenant_id: Option<String>,
    #[serde(default)]
    user: Option<AxisUser>,
    #[serde(default)]
    memberships: Option<Vec<Membership>>,
}

#[derive(Debug, Clone, Deserialize)]
struct SwitchResponse {
    access_token: String,
    #[serde(default, deserialize_with = "de_opt_string")]
    active_tenant_id: Option<String>,
    #[serde(default)]
    expires_in: Option<i64>,
}

// ── State ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct AuthState {
    access_token: String,
    expires_at: Instant,
    pub user: AxisUser,
    pub memberships: Vec<Membership>,
    pub active_tenant_id: String,
}

/// Public view of the signed-in identity (no tokens).
#[derive(Debug, Clone)]
pub struct Identity {
    pub user: AxisUser,
    pub memberships: Vec<Membership>,
    pub active_tenant_id: String,
}

pub struct Auth {
    http: reqwest::Client,
    axis_url: String,
    store: Arc<dyn SecretStore>,
    state: RwLock<Option<AuthState>>,
    generation: AtomicU64,
    refresh_lock: tokio::sync::Mutex<()>,
    /// Fired when Axis rejects the refresh token (forced sign-out).
    pub forced_out: tokio::sync::Notify,
}

fn expiry(expires_in: Option<i64>) -> Instant {
    let secs = expires_in.filter(|s| *s > 0).unwrap_or(900) as u64;
    Instant::now() + Duration::from_secs(secs)
}

impl Auth {
    pub fn new(http: reqwest::Client, axis_url: String, store: Arc<dyn SecretStore>) -> Self {
        Self {
            http,
            axis_url,
            store,
            state: RwLock::new(None),
            generation: AtomicU64::new(0),
            refresh_lock: tokio::sync::Mutex::new(()),
            forced_out: tokio::sync::Notify::new(),
        }
    }

    fn url(&self, path: &str) -> String {
        format!("{}/api/v1/auth/{}", self.axis_url, path)
    }

    pub fn device_id(&self) -> String {
        if let Some(id) = self.store.get(DEVICE_KEY) {
            return id;
        }
        // Fallback file keeps the id stable if the keychain is unavailable.
        let file = config::data_dir().join("device_id");
        let id = std::fs::read_to_string(&file)
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        if !self.store.set(DEVICE_KEY, &id) {
            let _ = std::fs::create_dir_all(config::data_dir());
            let _ = std::fs::write(&file, &id);
        }
        id
    }

    pub fn is_signed_in(&self) -> bool {
        self.state.read().map(|s| s.is_some()).unwrap_or(false)
    }

    pub fn has_stored_session(&self) -> bool {
        self.store.get(REFRESH_KEY).is_some()
    }

    pub fn identity(&self) -> Option<Identity> {
        let s = self.state.read().ok()?;
        s.as_ref().map(|s| Identity {
            user: s.user.clone(),
            memberships: s.memberships.clone(),
            active_tenant_id: s.active_tenant_id.clone(),
        })
    }

    fn apply(&self, r: AuthResponse) -> AppResult<()> {
        if let Some(rt) = r.refresh_token.as_deref().filter(|t| !t.is_empty()) {
            self.store.set(REFRESH_KEY, rt);
        }
        let mut guard = self.state.write().map_err(|_| AppError::server("auth state poisoned"))?;
        let prev = guard.take();
        let user = r.user.or_else(|| prev.as_ref().map(|p| p.user.clone())).unwrap_or_default();
        let memberships = r
            .memberships
            .filter(|m| !m.is_empty())
            .or_else(|| prev.as_ref().map(|p| p.memberships.clone()))
            .unwrap_or_default();
        let active = r
            .active_tenant_id
            .or_else(|| prev.as_ref().map(|p| p.active_tenant_id.clone()))
            .or_else(|| memberships.first().map(|m| m.tenant_id.clone()))
            .unwrap_or_default();
        *guard = Some(AuthState {
            access_token: r.access_token,
            expires_at: expiry(r.expires_in),
            user,
            memberships,
            active_tenant_id: active,
        });
        self.generation.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    async fn post_json(&self, path: &str, body: serde_json::Value, bearer: Option<&str>) -> AppResult<(u16, String)> {
        let mut req = self.http.post(self.url(path)).json(&body);
        if let Some(t) = bearer {
            req = req.bearer_auth(t);
        }
        let resp = req.send().await?;
        let status = resp.status().as_u16();
        let text = resp.text().await.unwrap_or_default();
        Ok((status, text))
    }

    pub async fn sign_in(&self, email: &str, password: &str) -> AppResult<()> {
        let email = email.trim();
        if email.is_empty() || password.is_empty() {
            return Err(AppError::validation("Enter your email and password."));
        }
        let body = json!({
            "email": email,
            "password": password,
            "device_id": self.device_id(),
            "device_name": config::device_name(),
            "platform": config::platform(),
        });
        let (status, text) = self.post_json("mobile/authenticate", body, None).await?;
        match status {
            200..=299 => {
                let r: AuthResponse = serde_json::from_str(&text)
                    .map_err(|_| AppError::server("Unexpected sign-in response from Axis."))?;
                self.apply(r)
            }
            401 => Err(AppError::unauthorized("Incorrect email or password.")),
            400 | 422 => Err(AppError::unauthorized(AppError::from_status(status, &text).message)),
            _ => Err(AppError::from_status(status, &text)),
        }
    }

    /// Restore a stored session at start-up. `Ok(false)` when nothing is stored.
    pub async fn restore(&self) -> AppResult<bool> {
        if !self.has_stored_session() {
            return Ok(false);
        }
        let generation = self.generation.load(Ordering::SeqCst);
        self.refresh(generation).await.map(|_| true)
    }

    /// Refresh the access token unless another caller already did since `seen_generation`.
    pub async fn refresh(&self, seen_generation: u64) -> AppResult<()> {
        let _guard = self.refresh_lock.lock().await;
        if self.generation.load(Ordering::SeqCst) != seen_generation && self.is_signed_in() {
            return Ok(());
        }
        let Some(rt) = self.store.get(REFRESH_KEY) else {
            self.clear_local();
            return Err(AppError::not_signed_in());
        };
        let body = json!({ "refresh_token": rt, "device_id": self.device_id() });
        let (status, text) = self.post_json("mobile/refresh", body, None).await?;
        match status {
            200..=299 => {
                let r: AuthResponse = serde_json::from_str(&text)
                    .map_err(|_| AppError::server("Unexpected refresh response from Axis."))?;
                self.apply(r)
            }
            400 | 401 | 403 if !text.contains("error code: 1010") => {
                log::warn!("Axis rejected the refresh token ({status}); signing out");
                let was_signed_in = self.is_signed_in();
                self.store.delete(REFRESH_KEY);
                self.clear_local();
                if was_signed_in {
                    self.forced_out.notify_one();
                }
                Err(AppError::unauthorized("Your session has ended. Please sign in again."))
            }
            _ => Err(AppError::from_status(status, &text)),
        }
    }

    /// Current access token (refreshing 60 s before expiry) and its generation.
    pub async fn access_token(&self) -> AppResult<(String, u64)> {
        let (token, expires_at, generation) = {
            let s = self.state.read().map_err(|_| AppError::server("auth state poisoned"))?;
            let s = s.as_ref().ok_or_else(AppError::not_signed_in)?;
            (s.access_token.clone(), s.expires_at, self.generation.load(Ordering::SeqCst))
        };
        if expires_at.saturating_duration_since(Instant::now()) > REFRESH_MARGIN {
            return Ok((token, generation));
        }
        match self.refresh(generation).await {
            Ok(()) => {}
            // Offline: still try the old token; the API answers 401 if it's really dead.
            Err(e) if e.is_retryable() => return Ok((token, generation)),
            Err(e) => return Err(e),
        }
        let s = self.state.read().map_err(|_| AppError::server("auth state poisoned"))?;
        let s = s.as_ref().ok_or_else(AppError::not_signed_in)?;
        Ok((s.access_token.clone(), self.generation.load(Ordering::SeqCst)))
    }

    pub async fn switch_tenant(&self, tenant_id: &str) -> AppResult<()> {
        let (token, _) = self.access_token().await?;
        let (status, text) = self.post_json("switch-tenant", json!({ "tenant_id": tenant_id }), Some(&token)).await?;
        if !(200..300).contains(&status) {
            return Err(AppError::from_status(status, &text));
        }
        let r: SwitchResponse =
            serde_json::from_str(&text).map_err(|_| AppError::server("Unexpected switch-company response from Axis."))?;
        let mut guard = self.state.write().map_err(|_| AppError::server("auth state poisoned"))?;
        if let Some(s) = guard.as_mut() {
            s.access_token = r.access_token;
            s.expires_at = expiry(r.expires_in);
            s.active_tenant_id = r.active_tenant_id.unwrap_or_else(|| tenant_id.to_string());
        }
        self.generation.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    /// Revoke the refresh token at Axis (best effort) and forget everything locally.
    pub async fn sign_out(&self) {
        if let Some(rt) = self.store.get(REFRESH_KEY) {
            let res = self.post_json("mobile/logout", json!({ "refresh_token": rt }), None).await;
            if let Err(e) = res {
                log::info!("Axis logout failed (ignored): {e}");
            }
        }
        self.store.delete(REFRESH_KEY);
        self.clear_local();
    }

    fn clear_local(&self) {
        if let Ok(mut g) = self.state.write() {
            *g = None;
        }
        self.generation.fetch_add(1, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_axis_authenticate_response() {
        let body = r#"{"access_token":"a","refresh_token":"r","expires_in":900,"active_tenant_id":"t1",
            "user":{"id":"u1","email":"e@x.com","first_name":"Anita","last_name":"Rao","display_name":null,"avatar_url":null},
            "memberships":[{"tenant_id":"t1","tenant_name":"Acme","slug":"acme","status":"active","apps_enabled":["pms"]}],
            "roles":{},"permissions":[],"active_orgs":[]}"#;
        let r: AuthResponse = serde_json::from_str(body).unwrap();
        assert_eq!(r.memberships.as_ref().unwrap()[0].tenant_name.as_deref(), Some("Acme"));
        assert_eq!(r.user.as_ref().unwrap().best_display_name(), "Anita Rao");
        let auth = Auth::new(reqwest::Client::new(), "http://x".into(), Arc::new(MemoryStore::default()));
        auth.apply(r).unwrap();
        assert!(auth.is_signed_in());
        assert!(auth.has_stored_session());
        assert_eq!(auth.identity().unwrap().active_tenant_id, "t1");
    }

    #[test]
    fn numeric_ids_become_strings() {
        let m: Membership = serde_json::from_str(r#"{"tenant_id": 42}"#).unwrap();
        assert_eq!(m.tenant_id, "42");
    }
}
