//! Tray icon, menu and window placement (docs/ARCHITECTURE.md sections 8 and 9).

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use image::{Rgba, RgbaImage};
use tauri::image::Image;
use tauri::menu::{CheckMenuItemBuilder, Menu, MenuBuilder, MenuItem, MenuItemBuilder, SubmenuBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_positioner::{Position, WindowExt};

use crate::app::Core;
use crate::types::{Navigate, TaskRef, TimerState, events};

const TRAY_ID: &str = "main";
const BASE_ICON: &[u8] = include_bytes!("../icons/64x64.png");
const RECENT_TTL: Duration = Duration::from_secs(5 * 60);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IconKind {
    Working,
    Amber,
    Idle,
    Stopped,
}

pub fn icon_kind(state: TimerState) -> IconKind {
    match state {
        TimerState::Working => IconKind::Working,
        TimerState::Paused | TimerState::Away | TimerState::Break => IconKind::Amber,
        TimerState::Idle => IconKind::Idle,
        TimerState::Stopped => IconKind::Stopped,
    }
}

/// The logo with a status dot in the bottom-right corner: teal / amber / grey, or a hollow ring when stopped.
pub fn badge(base: &RgbaImage, kind: IconKind) -> RgbaImage {
    let mut img = base.clone();
    let s = img.width().min(img.height()) as f32;
    let (cx, cy) = (s * 0.74, s * 0.74);
    let r_outer = s * 0.26;
    let r_dot = s * 0.20;
    let r_hole = s * 0.12;
    let color = match kind {
        IconKind::Working => Rgba([0x00, 0x7b, 0x88, 0xff]),
        IconKind::Amber => Rgba([0xf5, 0xa6, 0x23, 0xff]),
        IconKind::Idle => Rgba([0x9a, 0xa0, 0xa6, 0xff]),
        IconKind::Stopped => Rgba([0x6b, 0x72, 0x80, 0xff]),
    };
    let white = Rgba([0xff, 0xff, 0xff, 0xff]);
    for y in 0..img.height() {
        for x in 0..img.width() {
            let d = ((x as f32 + 0.5 - cx).powi(2) + (y as f32 + 0.5 - cy).powi(2)).sqrt();
            if d <= r_dot {
                let hollow = kind == IconKind::Stopped && d <= r_hole;
                img.put_pixel(x, y, if hollow { white } else { color });
            } else if d <= r_outer {
                img.put_pixel(x, y, white);
            }
        }
    }
    img
}

fn icon(kind: IconKind) -> Image<'static> {
    let base = image::load_from_memory(BASE_ICON).map(|i| i.to_rgba8()).unwrap_or_else(|_| RgbaImage::new(32, 32));
    let img = badge(&base, kind);
    let (w, h) = img.dimensions();
    Image::new_owned(img.into_raw(), w, h)
}

#[derive(Default)]
struct TrayState {
    key: String,
    icon: Option<IconKind>,
    status: Option<MenuItem<Wry>>,
    status_text: String,
    recent: Vec<TaskRef>,
    recent_at: Option<Instant>,
    recent_loading: bool,
    autostart: Option<bool>,
}

#[derive(Default)]
pub struct TrayHandle(Mutex<TrayState>);

fn status_line(core: &Core) -> String {
    if !core.auth.is_signed_in() {
        return "Not signed in".into();
    }
    let s = core.snapshot();
    let word = match s.state {
        TimerState::Stopped => return "○ Not tracking".into(),
        TimerState::Working if s.overtime => "Overtime",
        TimerState::Working => "Working",
        TimerState::Paused => "Paused",
        TimerState::Away => "Away",
        TimerState::Break => "On break",
        TimerState::Idle => "Idle",
    };
    let task = s.task.as_ref().map(|t| format!(" · {} · {}", t.project_name, t.title)).unwrap_or_default();
    format!("● {word}{task}   {}", crate::time::hhmm(s.elapsed_seconds))
}

fn structure_key(core: &Core, recent: &[TaskRef], autostart: bool) -> String {
    let signed = core.auth.is_signed_in();
    let id = core.auth.identity();
    let companies: Vec<String> = id
        .as_ref()
        .map(|i| i.memberships.iter().map(|m| m.tenant_id.clone()).collect())
        .unwrap_or_default();
    let s = core.snapshot();
    format!(
        "{signed}|{}|{:?}|{:?}|{}|{}|{}|{autostart}",
        core.silent(),
        s.state,
        s.task.as_ref().map(|t| t.task_id),
        companies.join(","),
        id.map(|i| i.active_tenant_id).unwrap_or_default(),
        recent.iter().map(|t| t.task_id.to_string()).collect::<Vec<_>>().join(","),
    )
}

fn build_menu(
    app: &AppHandle,
    core: &Core,
    recent: &[TaskRef],
    status: &str,
    autostart: bool,
) -> tauri::Result<(Menu<Wry>, MenuItem<Wry>)> {
    let status_item = MenuItemBuilder::with_id("status", status).enabled(false).build(app)?;
    let state = core.timer_state();
    let running = state != TimerState::Stopped;
    let (toggle_id, toggle_text, toggle_enabled) = match state {
        TimerState::Working => ("pause", "Pause", true),
        TimerState::Paused | TimerState::Away | TimerState::Idle => ("resume", "Resume", true),
        TimerState::Break => ("end_break", "End break", true),
        TimerState::Stopped => ("pause", "Pause", false),
    };
    let toggle = MenuItemBuilder::with_id(toggle_id, toggle_text).enabled(toggle_enabled).build(app)?;
    let stop = MenuItemBuilder::with_id("stop", "Stop").enabled(running).build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

    if !core.auth.is_signed_in() {
        let menu = MenuBuilder::new(app)
            .item(&status_item)
            .separator()
            .text("open", "Sign in…")
            .text("open_web", "Open PMS")
            .separator()
            .item(&quit)
            .build()?;
        return Ok((menu, status_item));
    }

    if core.silent() {
        let menu = MenuBuilder::new(app)
            .text("open", "Open")
            .item(&toggle)
            .item(&stop)
            .text("about", "About")
            .separator()
            .item(&quit)
            .build()?;
        return Ok((menu, status_item));
    }

    let away = MenuItemBuilder::with_id("away", "Away").enabled(state == TimerState::Working).build(app)?;

    let mut start_on = SubmenuBuilder::with_id(app, "start_on", "Start on");
    for (i, t) in recent.iter().enumerate() {
        start_on = start_on.text(format!("start:{i}"), format!("{} · {}", t.project_name, t.title));
    }
    if !recent.is_empty() {
        start_on = start_on.separator();
    }
    let start_on = start_on.text("choose", "Choose another task…").build()?;

    let id = core.auth.identity();
    let mut companies = SubmenuBuilder::with_id(app, "companies", "Switch company").enabled(!running);
    if let Some(id) = &id {
        for m in &id.memberships {
            let name = m.tenant_name.clone().or_else(|| m.slug.clone()).unwrap_or_else(|| m.tenant_id.clone());
            let item = CheckMenuItemBuilder::with_id(format!("company:{}", m.tenant_id), name)
                .checked(m.tenant_id == id.active_tenant_id)
                .enabled(!running)
                .build(app)?;
            companies = companies.item(&item);
        }
    }
    let companies = companies.build()?;
    let autostart = CheckMenuItemBuilder::with_id("autostart", "Start at login")
        .checked(autostart)
        .build(app)?;

    let mut menu = MenuBuilder::new(app).item(&status_item).separator();
    // Linux tray icons (AppIndicator) send no click events, so the window needs a menu entry.
    if cfg!(target_os = "linux") {
        menu = menu.text("open", "Open PMS Desktop").separator();
    }
    let menu = menu
        .item(&toggle)
        .item(&away)
        .item(&stop)
        .separator()
        .item(&start_on)
        .item(&companies)
        .separator()
        .text("open_web", "Open PMS")
        .item(&autostart)
        .separator()
        .item(&quit)
        .build()?;
    Ok((menu, status_item))
}

/// Rebuild the menu when its structure changed; otherwise just update the status line and icon.
pub fn refresh(app: &AppHandle, core: &Core) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else { return };
    let Some(handle) = app.try_state::<TrayHandle>() else { return };
    let status = status_line(core);
    let kind = if core.auth.is_signed_in() { icon_kind(core.timer_state()) } else { IconKind::Stopped };
    let mut st = handle.0.lock().unwrap_or_else(|p| p.into_inner());

    let recent_stale = st.recent_at.is_none_or(|t| t.elapsed() > RECENT_TTL);
    if core.auth.is_signed_in() && !core.silent() && recent_stale && !st.recent_loading {
        st.recent_loading = true;
        let app2 = app.clone();
        tauri::async_runtime::spawn(async move {
            let core = app2.state::<Arc<Core>>().inner().clone();
            let recent = core.recent_tasks().await;
            if let Some(h) = app2.try_state::<TrayHandle>() {
                let mut st = h.0.lock().unwrap_or_else(|p| p.into_inner());
                st.recent_loading = false;
                st.recent_at = Some(Instant::now());
                if let Ok(r) = recent {
                    st.recent = r;
                }
            }
        });
    }
    if !core.auth.is_signed_in() {
        st.recent.clear();
        st.recent_at = None;
    }

    let autostart = *st.autostart.get_or_insert_with(|| app.autolaunch().is_enabled().unwrap_or(false));
    let key = structure_key(core, &st.recent, autostart);
    if key != st.key {
        match build_menu(app, core, &st.recent.clone(), &status, autostart) {
            Ok((menu, status_item)) => {
                if let Err(e) = tray.set_menu(Some(menu)) {
                    log::warn!("tray menu: {e}");
                }
                st.status = Some(status_item);
                st.status_text = status.clone();
                st.key = key;
            }
            Err(e) => log::warn!("tray menu build: {e}"),
        }
    } else if st.status_text != status {
        if let Some(item) = &st.status {
            let _ = item.set_text(&status);
        }
        st.status_text = status.clone();
    }
    if st.icon != Some(kind) {
        let _ = tray.set_icon(Some(icon(kind)));
        st.icon = Some(kind);
    }
    let _ = tray.set_tooltip(Some(format!("PMS Desktop — {status}")));
}

pub fn show_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.move_window_constrained(Position::TrayCenter).is_err() {
            let fallback = if cfg!(target_os = "windows") { Position::BottomRight } else { Position::TopRight };
            let _ = w.move_window(fallback);
        }
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn toggle_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            show_window(app);
        }
    }
}

fn spawn_op<F, Fut>(app: &AppHandle, f: F)
where
    F: FnOnce(Arc<Core>) -> Fut + Send + 'static,
    Fut: std::future::Future<Output = ()> + Send + 'static,
{
    let core = app.state::<Arc<Core>>().inner().clone();
    tauri::async_runtime::spawn(f(core));
}

fn report<T>(core: &Core, r: crate::error::AppResult<T>) {
    if let Err(e) = r {
        core.ui.toast(crate::types::ToastKind::Error, e.message);
    }
}

pub fn request_quit(app: &AppHandle) {
    let core = app.state::<Arc<Core>>().inner().clone();
    if !core.is_running() {
        app.exit(0);
        return;
    }
    let app2 = app.clone();
    app.dialog()
        .message("A timer is running. Quitting stops it.")
        .title("Quit PMS Desktop?")
        .buttons(MessageDialogButtons::OkCancelCustom("Stop and quit".into(), "Cancel".into()))
        .show(move |ok| {
            if ok {
                tauri::async_runtime::spawn(async move {
                    core.shutdown().await;
                    app2.exit(0);
                });
            }
        });
}

fn on_menu(app: &AppHandle, id: &str) {
    match id {
        "pause" => spawn_op(app, |c| async move { report(&c, c.pause_timer().await) }),
        "resume" => spawn_op(app, |c| async move { report(&c, c.resume_timer().await) }),
        "end_break" => spawn_op(app, |c| async move { report(&c, c.end_break().await) }),
        "away" => spawn_op(app, |c| async move { report(&c, c.away_timer().await) }),
        "stop" => spawn_op(app, |c| async move { report(&c, c.stop_timer().await) }),
        "choose" => {
            show_window(app);
            app.state::<Arc<Core>>().ui.emit(events::NAVIGATE, Navigate { to: "picker" });
        }
        "open" => show_window(app),
        "open_web" => {
            let url = app.state::<Arc<Core>>().cfg.web_url.clone();
            use tauri_plugin_opener::OpenerExt;
            let _ = app.opener().open_url(url, None::<&str>);
        }
        "autostart" => {
            let al = app.autolaunch();
            let r = if al.is_enabled().unwrap_or(false) { al.disable() } else { al.enable() };
            if let Err(e) = r {
                log::warn!("autostart toggle: {e}");
            }
            if let Some(h) = app.try_state::<TrayHandle>() {
                h.0.lock().unwrap_or_else(|p| p.into_inner()).autostart = None;
            }
            refresh(app, &app.state::<Arc<Core>>());
        }
        "about" => {
            let core = app.state::<Arc<Core>>();
            app.dialog()
                .message(format!("PMS Desktop {}\n{}", crate::config::VERSION, core.cfg.api_url))
                .title("About PMS Desktop")
                .buttons(MessageDialogButtons::Ok)
                .show(|_| {});
        }
        "quit" => request_quit(app),
        other => {
            if let Some(idx) = other.strip_prefix("start:").and_then(|i| i.parse::<usize>().ok()) {
                let task = app
                    .try_state::<TrayHandle>()
                    .and_then(|h| h.0.lock().ok().and_then(|st| st.recent.get(idx).cloned()));
                if let Some(task) = task {
                    spawn_op(app, |c| async move {
                        let r = c.start_timer(task).await;
                        if r.is_ok() {
                            c.ui.emit(events::NAVIGATE, Navigate { to: "timer" });
                        }
                        report(&c, r)
                    });
                }
            } else if let Some(tenant) = other.strip_prefix("company:") {
                let tenant = tenant.to_string();
                spawn_op(app, |c| async move { report(&c, c.switch_company(&tenant).await) });
            }
        }
    }
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    app.manage(TrayHandle::default());
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon(IconKind::Stopped))
        .tooltip("PMS Desktop")
        .menu(&MenuBuilder::new(app).text("quit", "Quit").build()?)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| on_menu(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                toggle_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn badge_colors_corner_and_keeps_logo() {
        let base = RgbaImage::from_pixel(64, 64, Rgba([1, 2, 3, 255]));
        let w = badge(&base, IconKind::Working);
        assert_eq!(*w.get_pixel(47, 47), Rgba([0x00, 0x7b, 0x88, 0xff]));
        assert_eq!(*w.get_pixel(5, 5), Rgba([1, 2, 3, 255]));
        let s = badge(&base, IconKind::Stopped);
        assert_eq!(*s.get_pixel(47, 47), Rgba([0xff, 0xff, 0xff, 0xff]));
        assert_eq!(icon_kind(TimerState::Break), IconKind::Amber);
        assert_eq!(icon_kind(TimerState::Idle), IconKind::Idle);
    }
}
