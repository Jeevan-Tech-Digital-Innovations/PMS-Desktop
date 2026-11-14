//! `AppError` is what every command rejects with (docs/ARCHITECTURE.md section 4).

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ErrorCode {
    Offline,
    Unauthorized,
    Server,
    Validation,
    Busy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }
    pub fn offline() -> Self {
        Self::new(ErrorCode::Offline, "You appear to be offline. We'll retry automatically.")
    }
    pub fn unauthorized(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Unauthorized, message)
    }
    pub fn server(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Server, message)
    }
    pub fn validation(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Validation, message)
    }
    pub fn busy(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Busy, message)
    }
    pub fn not_signed_in() -> Self {
        Self::unauthorized("Please sign in.")
    }

    /// Map an HTTP status + response body to an error. The body's `message` (Spring / Axis style) is used
    /// when present; it never contains secrets.
    pub fn from_status(status: u16, body: &str) -> Self {
        let msg = extract_message(body);
        match status {
            401 => Self::unauthorized(msg.unwrap_or_else(|| "Your session has expired. Please sign in again.".into())),
            403 => Self::server(msg.unwrap_or_else(|| "You don't have access to this.".into())),
            409 => Self::busy(msg.unwrap_or_else(|| "Another change is in progress.".into())),
            400 | 404 | 422 => Self::validation(msg.unwrap_or_else(|| format!("Request rejected ({status})."))),
            _ => Self::server(msg.unwrap_or_else(|| format!("Server error ({status}). Please try again."))),
        }
    }

    /// Worth retrying later (queue): network failures and 5xx / 429.
    pub fn is_retryable(&self) -> bool {
        matches!(self.code, ErrorCode::Offline | ErrorCode::Server | ErrorCode::Busy)
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}

impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        if e.is_connect() || e.is_timeout() || e.is_request() {
            AppError::offline()
        } else if e.is_decode() {
            AppError::server("Unexpected response from the server.")
        } else {
            AppError::offline()
        }
    }
}

fn extract_message(body: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    for key in ["message", "error_description", "detail", "error"] {
        if let Some(s) = v.get(key).and_then(|m| m.as_str()) {
            let s = s.trim();
            if !s.is_empty() && s.len() < 300 {
                return Some(s.to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_statuses() {
        assert_eq!(AppError::from_status(401, "").code, ErrorCode::Unauthorized);
        assert_eq!(AppError::from_status(400, r#"{"message":"bad"}"#).message, "bad");
        assert_eq!(AppError::from_status(503, "error code: 1010").code, ErrorCode::Server);
        assert!(AppError::from_status(502, "").is_retryable());
        assert!(!AppError::from_status(404, "").is_retryable());
    }

    #[test]
    fn serializes_lowercase_code() {
        let s = serde_json::to_string(&AppError::busy("x")).unwrap();
        assert_eq!(s, r#"{"code":"busy","message":"x"}"#);
    }
}
