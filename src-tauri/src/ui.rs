//! Events to the webview and native notifications. Silent tracking mode suppresses every toast,
//! notification and prompt; `timer:changed` / `session:changed` / `navigate` always flow.

use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::types::{Toast, ToastKind, events};

#[derive(Default)]
pub struct Ui {
    app: OnceLock<AppHandle>,
    silent: AtomicBool,
}

impl Ui {
    pub fn attach(&self, app: AppHandle) {
        let _ = self.app.set(app);
    }

    pub fn app(&self) -> Option<&AppHandle> {
        self.app.get()
    }

    pub fn set_silent(&self, silent: bool) {
        self.silent.store(silent, Ordering::Relaxed);
    }

    pub fn silent(&self) -> bool {
        self.silent.load(Ordering::Relaxed)
    }

    pub fn emit<S: Serialize + Clone>(&self, event: &str, payload: S) {
        if let Some(app) = self.app.get()
            && let Err(e) = app.emit(event, payload)
        {
            log::debug!("emit {event} failed: {e}");
        }
    }

    /// UI prompts (`idle:started`, `overtime:prompt`, …): visible mode only.
    pub fn prompt<S: Serialize + Clone>(&self, event: &str, payload: S) {
        if !self.silent() {
            self.emit(event, payload);
        }
    }

    pub fn toast(&self, kind: ToastKind, message: impl Into<String>) {
        if !self.silent() {
            self.emit(events::TOAST, Toast { kind, message: message.into() });
        }
    }

    pub fn notify(&self, title: &str, body: &str) {
        if self.silent() {
            return;
        }
        if let Some(app) = self.app.get() {
            use tauri_plugin_notification::NotificationExt;
            if let Err(e) = app.notification().builder().title(title).body(body).show() {
                log::debug!("notification failed: {e}");
            }
        }
    }

    pub fn show_window(&self) {
        if let Some(app) = self.app.get() {
            crate::tray::show_window(app);
        }
    }

    pub fn main_window_visible(&self) -> bool {
        self.app
            .get()
            .and_then(|a| a.get_webview_window("main"))
            .and_then(|w| w.is_visible().ok())
            .unwrap_or(false)
    }
}
