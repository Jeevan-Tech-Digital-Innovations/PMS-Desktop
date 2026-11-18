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

/// `identifier` and `productName` after the `--config` overlays. The Tauri CLI passes overlays (for example
/// `tauri.staging.conf.json`) to cargo as JSON in `TAURI_CONFIG`; tauri-build merges them the same way. The keychain
/// service and the data folder follow the identifier, so staging and production never share a session.
fn app_names() -> (String, String) {
    let base = std::fs::read_to_string("tauri.conf.json").expect("read tauri.conf.json");
    let base: serde_json::Value = serde_json::from_str(&base).expect("tauri.conf.json is JSON");
    let overlay: Option<serde_json::Value> =
        std::env::var("TAURI_CONFIG").ok().map(|s| serde_json::from_str(&s).expect("TAURI_CONFIG is JSON"));
    let pick = |key: &str| {
        overlay
            .as_ref()
            .and_then(|o| o.get(key))
            .or_else(|| base.get(key))
            .and_then(|v| v.as_str())
            .map(str::to_string)
    };
    let identifier = pick("identifier").expect("tauri.conf.json has an identifier");
    (identifier, pick("productName").unwrap_or_else(|| "PMS Desktop".into()))
}

fn main() {
    let (identifier, product_name) = app_names();
    println!("cargo:rerun-if-changed=tauri.conf.json");
    println!("cargo:rerun-if-env-changed=TAURI_CONFIG");
    // Compiled in (option_env!) by src/updater.rs; the public key switches the updater on.
    println!("cargo:rerun-if-env-changed=UPDATER_PUBKEY");
    println!("cargo:rerun-if-env-changed=UPDATER_ENDPOINT");
    println!("cargo:rustc-env=PMS_APP_IDENTIFIER={identifier}");
    println!("cargo:rustc-env=PMS_PRODUCT_NAME={product_name}");

    // Generates an `allow-<command>` permission per app command; capabilities/default.json grants them.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)))
        .expect("tauri build script");
}
