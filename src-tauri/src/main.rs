// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(debug_assertions)]
    if std::env::args().any(|a| a == "--selftest") {
        std::process::exit(pms_desktop_lib::selftest::run());
    }
    #[cfg(debug_assertions)]
    if std::env::args().any(|a| a == "--e2e") {
        std::process::exit(pms_desktop_lib::e2e::run());
    }
    pms_desktop_lib::run()
}
