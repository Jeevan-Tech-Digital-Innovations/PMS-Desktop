const COMMANDS: &[&str] = &[
    "get_session",
    "sign_in",
    "sign_out",
    "accept_first_run_notice",
    "switch_company",
    "list_projects",
    "list_tasks",
    "list_subtasks",
    "search_tasks",
    "recent_tasks",
    "get_timer",
    "start_timer",
    "pause_timer",
    "resume_timer",
    "away_timer",
    "stop_timer",
    "list_break_reasons",
    "start_break",
    "end_break",
    "submit_idle_note",
    "overtime_decision",
    "open_pms_web",
    "app_info",
];

fn main() {
    // Generates an `allow-<command>` permission per app command; capabilities/default.json grants them.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)))
        .expect("tauri build script");
}
