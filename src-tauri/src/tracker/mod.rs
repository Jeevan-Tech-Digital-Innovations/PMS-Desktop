//! Activity tracking while a timer runs: system idle, screenshots, app usage, sleep/lock.

pub mod apps;
pub mod idle;
#[cfg(target_os = "linux")]
pub mod linux;
pub mod power;
pub mod screenshot;
