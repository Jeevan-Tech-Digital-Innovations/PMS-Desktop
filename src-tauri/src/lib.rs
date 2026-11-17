//! PMS Desktop 2: Rust core. Contract with the React screen: docs/ARCHITECTURE.md.

pub mod alive;
pub mod api;
pub mod app;
pub mod auth;
pub mod catalog;
pub mod commands;
pub mod config;
pub mod error;
pub mod queue;
#[cfg(debug_assertions)]
pub mod e2e;
#[cfg(debug_assertions)]
pub mod selftest;
pub mod settings;
pub mod time;
pub mod timer;
pub mod tracker;
pub mod tray;
pub mod types;
pub mod ui;
pub mod updater;

use std::sync::Arc;

use app::Core;
use tauri::{Manager, RunEvent, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cfg = config::Config::load();
    let core = app::Core::new(cfg, Arc::new(auth::KeychainStore::new()));
    let setup_core = core.clone();

    let context = tauri::generate_context!();
    // The updater plugin needs `plugins.updater` in the config (CI writes it with the public key) and fails to
    // initialise without it, so it is registered only when both the key and the config are there.
    let updater_on = !updater::pubkey().is_empty() && context.config().plugins.0.contains_key("updater");
    updater::set_enabled(updater_on);

    let builder = tauri::Builder::default()
        // Must be the first plugin: a second launch just focuses the running window.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| tray::show_window(app)))
        .plugin(tauri_plugin_log::Builder::new().level(log::LevelFilter::Info).build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None));
    let builder = if updater_on {
        builder.plugin(tauri_plugin_updater::Builder::new().pubkey(updater::pubkey()).build())
    } else {
        builder
    };
    builder
        .manage(core)
        .invoke_handler(tauri::generate_handler![
            commands::get_session,
            commands::sign_in,
            commands::sign_out,
            commands::accept_first_run_notice,
            commands::switch_company,
            commands::list_projects,
            commands::list_tasks,
            commands::list_subtasks,
            commands::search_tasks,
            commands::recent_tasks,
            commands::get_timer,
            commands::start_timer,
            commands::pause_timer,
            commands::resume_timer,
            commands::away_timer,
            commands::stop_timer,
            commands::list_break_reasons,
            commands::start_break,
            commands::end_break,
            commands::submit_idle_note,
            commands::overtime_decision,
            commands::open_pms_web,
            commands::app_info,
        ])
        .on_window_event(|window, event| {
            // Closing the window hides it; the agent keeps running in the tray.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let core = setup_core;
            log::info!(
                "{} {} starting ({}, API {}, dev {}, linux session {:?})",
                config::PRODUCT_NAME,
                config::VERSION,
                config::APP_IDENTIFIER,
                core.cfg.api_url,
                core.cfg.dev,
                config::linux_session()
            );
            // Staging builds say so in the title bar.
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_title(config::PRODUCT_NAME);
            }
            core.ui.attach(app.handle().clone());
            tray::create(app.handle())?;
            core.spawn_background();
            updater::spawn(app.handle().clone(), core.clone());
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let signed_in = core.startup().await;
                tray::refresh(&handle, &core);
                core.emit_timer();
                // Visible mode opens the window at start-up only when signed out
                // (debug builds: `PMS_DEV_SHOW_WINDOW=1` always opens it).
                if !signed_in || (cfg!(debug_assertions) && core.cfg.dev_show_window) {
                    tray::show_window(&handle);
                }
            });
            Ok(())
        })
        .build(context)
        .expect("error while building PMS Desktop")
        .run(|app, event| match event {
            // Keep running in the tray when no window is visible; explicit `exit(code)` still quits.
            RunEvent::ExitRequested { code: None, api, .. } => api.prevent_exit(),
            // Last chance to stop a running timer. On Windows, tao turns WM_ENDSESSION (shutdown, restart, log-off)
            // into this event on the UI thread, then ends the process as soon as we return, so the stop is one
            // blocking HTTP call under a hard budget (`Core::stop_on_exit`). A no-op when no timer is running,
            // which is also the case after "Quit" (it stops the timer first).
            RunEvent::Exit => {
                if let Some(core) = app.try_state::<Arc<Core>>() {
                    core.stop_on_exit(app::EXIT_STOP_BUDGET);
                }
            }
            _ => {}
        });
}
