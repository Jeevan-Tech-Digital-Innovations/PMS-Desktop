//! App usage: active window → `{appName, url}` sessions (docs/ARCHITECTURE.md sections 3 and 7).
//!
//! `appName` is always the **program** taken from the OS process (exe file name through a friendly-name
//! map first, then the OS-provided product name), never a window title. `url` is the window title with
//! the trailing " - <program>" suffix removed.

use chrono::{DateTime, Local};
use serde_json::{Value, json};

use crate::settings::TrackApps;
use crate::time;

pub const OWN_APP_NAME: &str = "PMS Desktop";

/// Lower-case exe stem (or macOS app name) → friendly program name.
const FRIENDLY: &[(&str, &str)] = &[
    ("chrome", "Google Chrome"),
    ("google chrome", "Google Chrome"),
    ("msedge", "Microsoft Edge"),
    ("microsoft edge", "Microsoft Edge"),
    ("firefox", "Mozilla Firefox"),
    ("mozilla firefox", "Mozilla Firefox"),
    ("brave", "Brave"),
    ("brave browser", "Brave"),
    ("opera", "Opera"),
    ("safari", "Safari"),
    ("iexplore", "Internet Explorer"),
    ("code", "Visual Studio Code"),
    ("visual studio code", "Visual Studio Code"),
    ("devenv", "Visual Studio"),
    ("idea64", "IntelliJ IDEA"),
    ("excel", "Microsoft Excel"),
    ("microsoft excel", "Microsoft Excel"),
    ("winword", "Microsoft Word"),
    ("microsoft word", "Microsoft Word"),
    ("powerpnt", "Microsoft PowerPoint"),
    ("microsoft powerpoint", "Microsoft PowerPoint"),
    ("outlook", "Microsoft Outlook"),
    ("olk", "Microsoft Outlook"),
    ("microsoft outlook", "Microsoft Outlook"),
    ("onenote", "Microsoft OneNote"),
    ("teams", "Microsoft Teams"),
    ("ms-teams", "Microsoft Teams"),
    ("msteams", "Microsoft Teams"),
    ("microsoft teams", "Microsoft Teams"),
    ("explorer", "File Explorer"),
    ("finder", "Finder"),
    ("notepad", "Notepad"),
    ("notepad++", "Notepad++"),
    ("windowsterminal", "Windows Terminal"),
    ("cmd", "Command Prompt"),
    ("powershell", "Windows PowerShell"),
    ("pwsh", "PowerShell"),
    ("mstsc", "Remote Desktop Connection"),
    ("slack", "Slack"),
    ("zoom", "Zoom"),
    ("zoom.us", "Zoom"),
    ("acrobat", "Adobe Acrobat"),
    ("acrord32", "Adobe Acrobat Reader"),
    ("figma", "Figma"),
    ("postman", "Postman"),
    ("terminal", "Terminal"),
    ("iterm2", "iTerm2"),
    // Linux: exe stems and X11 WM_CLASS names.
    ("google-chrome", "Google Chrome"),
    ("chromium", "Chromium"),
    ("chromium-browser", "Chromium"),
    ("microsoft-edge", "Microsoft Edge"),
    ("teams-for-linux", "Microsoft Teams"),
    ("gnome-terminal-server", "Terminal"),
    ("gnome-terminal", "Terminal"),
    ("nautilus", "Files"),
    ("org.gnome.nautilus", "Files"),
    ("gnome-text-editor", "Text Editor"),
    ("gedit", "Text Editor"),
    ("soffice", "LibreOffice"),
    ("soffice.bin", "LibreOffice"),
    ("libreoffice", "LibreOffice"),
    ("thunderbird", "Thunderbird"),
    // Ourselves (exe stem, product name, legacy package description prefix).
    ("pms-desktop", OWN_APP_NAME),
    ("pms_desktop", OWN_APP_NAME),
    ("pms desktop", OWN_APP_NAME),
];

fn friendly(key: &str) -> Option<&'static str> {
    let k = key.trim().to_lowercase();
    FRIENDLY.iter().find(|(from, _)| *from == k).map(|(_, to)| *to)
}

fn strip_exe(s: &str) -> &str {
    let s = s.trim();
    if s.len() > 4 && s[s.len() - 4..].eq_ignore_ascii_case(".exe") { &s[..s.len() - 4] } else { s }
}

/// A product/description name is usable only when it is short and clearly a name, not a sentence.
fn clean_product_name(s: &str) -> Option<String> {
    let s = strip_exe(s);
    let bad = s.is_empty() || s.chars().count() > 40 || [" — ", " – ", " - ", " | ", ", "].iter().any(|sep| s.contains(sep));
    if bad { None } else { Some(s.to_string()) }
}

/// Program name from the process. `exe_stem`: file name without extension (Windows `chrome`, macOS
/// `Google Chrome`); `os_name`: what the OS reports (Windows file description, macOS localized name).
pub fn program_name(exe_stem: &str, os_name: &str, is_self: bool) -> String {
    if is_self {
        return OWN_APP_NAME.to_string();
    }
    let stem = strip_exe(exe_stem);
    if let Some(f) = friendly(stem) {
        return f.to_string();
    }
    if let Some(f) = friendly(strip_exe(os_name)) {
        return f.to_string();
    }
    if os_name.to_lowercase().starts_with("workstatus desktop") || os_name.to_lowercase().starts_with("pms desktop") {
        return OWN_APP_NAME.to_string();
    }
    if let Some(p) = clean_product_name(os_name) {
        return p;
    }
    if !stem.is_empty() {
        return stem.to_string();
    }
    UNKNOWN_APP.to_string()
}

fn normalize_for_compare(s: &str) -> String {
    s.chars()
        .filter(|c| !matches!(c, '\u{200B}' | '\u{200C}' | '\u{200D}' | '\u{FEFF}' | '\u{200E}' | '\u{200F}'))
        .collect::<String>()
        .trim()
        .to_lowercase()
}

/// Window title without the trailing program suffix. `aliases` are other names the program uses in
/// titles (OS name, exe stem).
pub fn clean_title(title: &str, program: &str, aliases: &[&str]) -> String {
    let title = title.trim();
    if title.is_empty() {
        return String::new();
    }
    let mut names: Vec<String> = vec![program.to_string()];
    for prefix in ["Microsoft ", "Google ", "Mozilla "] {
        if let Some(short) = program.strip_prefix(prefix) {
            names.push(short.to_string());
        }
    }
    names.extend(aliases.iter().map(|a| strip_exe(a).to_string()).filter(|a| !a.is_empty()));
    let names: Vec<String> = names.iter().map(|n| normalize_for_compare(n)).filter(|n| !n.is_empty()).collect();

    if names.iter().any(|n| *n == normalize_for_compare(title)) {
        return String::new();
    }
    for sep in [" - ", " — ", " – ", " | "] {
        if let Some(idx) = title.rfind(sep) {
            let suffix = normalize_for_compare(&title[idx + sep.len()..]);
            if names.contains(&suffix) {
                return title[..idx].trim_end().to_string();
            }
        }
    }
    title.to_string()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WindowInfo {
    pub app: String,
    pub title: String,
}

/// App name recorded when the program cannot be read at all (GNOME on Wayland, native Wayland windows).
pub const UNKNOWN_APP: &str = "Unknown";

/// Read the foreground window. Blocking but fast; call from a blocking-friendly context.
///
/// On a Linux Wayland session only X11 (XWayland) windows can be read; for anything else the time is
/// recorded as [`UNKNOWN_APP`] with no title instead of being dropped.
pub fn active_window() -> Option<WindowInfo> {
    let Ok(w) = active_win_pos_rs::get_active_window() else {
        return crate::config::is_wayland().then(|| WindowInfo { app: UNKNOWN_APP.to_string(), title: String::new() });
    };
    let stem = w.process_path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
    let is_self = w.process_id == u64::from(std::process::id());
    let os_name = w.app_name.clone();
    // On macOS the localized app name is reliable; on Windows prefer the exe stem (see `program_name`).
    let app = if cfg!(target_os = "macos") {
        program_name(&os_name, &stem, is_self)
    } else {
        program_name(&stem, &os_name, is_self)
    };
    let title = clean_title(&w.title, &app, &[&os_name, &stem]);
    Some(WindowInfo { app, title })
}

#[derive(Debug, Clone, PartialEq)]
pub struct UsageRecord {
    pub app: String,
    pub url: String,
    pub start: DateTime<Local>,
    pub end: DateTime<Local>,
}

impl UsageRecord {
    pub fn seconds(&self) -> i64 {
        (self.end - self.start).num_seconds().max(0)
    }
}

/// Builds sessions: a session closes when the program or title changes.
#[derive(Debug, Default)]
pub struct UsageTracker {
    current: Option<(WindowInfo, DateTime<Local>)>,
    done: Vec<UsageRecord>,
}

impl UsageTracker {
    pub fn observe(&mut self, w: Option<WindowInfo>, now: DateTime<Local>) {
        match (&self.current, w) {
            (Some((cur, _)), Some(w)) if *cur == w => {}
            (_, w) => {
                self.close(now);
                self.current = w.map(|w| (w, now));
            }
        }
    }

    fn close(&mut self, now: DateTime<Local>) {
        if let Some((w, start)) = self.current.take() {
            let rec = UsageRecord { app: w.app, url: w.title, start, end: now };
            if rec.seconds() >= 1 {
                self.done.push(rec);
            }
        }
    }

    /// Close everything up to `now`; the current window keeps being tracked as a new session.
    pub fn drain(&mut self, now: DateTime<Local>) -> Vec<UsageRecord> {
        let cur = self.current.as_ref().map(|(w, _)| w.clone());
        self.close(now);
        self.current = cur.map(|w| (w, now));
        std::mem::take(&mut self.done)
    }

    /// Close everything and stop (timer stopped / paused / new log).
    pub fn finish(&mut self, now: DateTime<Local>) -> Vec<UsageRecord> {
        self.close(now);
        std::mem::take(&mut self.done)
    }
}

/// `POST /activity/apps/bulk` body with `trackAppsUrls` masking. `None` when tracking is off or empty.
pub fn usage_payload(records: &[UsageRecord], time_log_id: i64, mode: TrackApps) -> Option<Value> {
    if mode == TrackApps::Off || records.is_empty() {
        return None;
    }
    let items: Vec<Value> = records
        .iter()
        .map(|r| {
            let (app, url) = match mode {
                TrackApps::AppsOnly => (r.app.as_str(), "Restricted"),
                TrackApps::UrlsOnly => ("Restricted", r.url.as_str()),
                _ => (r.app.as_str(), r.url.as_str()),
            };
            json!({
                "appName": app,
                "url": url,
                "startTime": time::api_ts(&r.start),
                "endTime": time::api_ts(&r.end),
                "durationSeconds": r.seconds(),
                "timeLogId": time_log_id,
            })
        })
        .collect();
    Some(Value::Array(items))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn doc_example_chrome_title() {
        let app = program_name("chrome", "Google Chrome", false);
        assert_eq!(app, "Google Chrome");
        assert_eq!(
            clean_title("Dashboard ‹ SIMTA Astrix — WordPress - Google Chrome", &app, &["Google Chrome", "chrome"]),
            "Dashboard ‹ SIMTA Astrix — WordPress"
        );
    }

    #[test]
    fn windows_exe_names_map_to_programs() {
        let cases = [
            ("chrome", "Google Chrome"),
            ("msedge", "Microsoft Edge"),
            ("firefox", "Mozilla Firefox"),
            ("brave", "Brave"),
            ("Code", "Visual Studio Code"),
            ("EXCEL", "Microsoft Excel"),
            ("WINWORD", "Microsoft Word"),
            ("OUTLOOK", "Microsoft Outlook"),
            ("Teams", "Microsoft Teams"),
            ("ms-teams", "Microsoft Teams"),
            ("explorer", "File Explorer"),
            ("notepad", "Notepad"),
            ("Notepad.exe", "Notepad"),
        ];
        for (exe, want) in cases {
            assert_eq!(program_name(exe, "", false), want, "{exe}");
        }
    }

    #[test]
    fn exe_map_wins_over_os_description() {
        // Electron reported "Windows Explorer" for explorer.exe; the exe map is authoritative.
        assert_eq!(program_name("explorer", "Windows Explorer", false), "File Explorer");
        assert_eq!(program_name("notepad", "Notepad.exe", false), "Notepad");
    }

    #[test]
    fn system_processes_fall_back_to_exe_name() {
        for exe in ["LockApp", "ShellHost", "SearchHost", "StartMenuExperienceHost", "ShellExperienceHost"] {
            assert_eq!(program_name(exe, "", false), exe);
            assert_eq!(program_name(&format!("{exe}.exe"), &format!("{exe}.exe"), false), exe);
        }
    }

    #[test]
    fn unknown_exe_uses_clean_product_name_else_stem() {
        assert_eq!(program_name("Spotify", "Spotify", false), "Spotify");
        assert_eq!(program_name("foo", "Foo Studio", false), "Foo Studio");
        assert_eq!(
            program_name("weird", "Some Tool — a very long description of what this tool does for you", false),
            "weird"
        );
        assert_eq!(program_name("", "", false), "Unknown");
    }

    #[test]
    fn our_own_process_is_pms_desktop() {
        assert_eq!(program_name("anything", "anything", true), OWN_APP_NAME);
        assert_eq!(program_name("pms-desktop", "", false), OWN_APP_NAME);
        assert_eq!(
            program_name(
                "Workstatus",
                "Workstatus Desktop Application — Time tracking, activity monitoring, and screenshot capture",
                false
            ),
            OWN_APP_NAME
        );
    }

    #[test]
    fn macos_names() {
        assert_eq!(program_name("Google Chrome", "Google Chrome", false), "Google Chrome");
        assert_eq!(program_name("Code", "Electron", false), "Visual Studio Code");
        assert_eq!(program_name("Finder", "Finder", false), "Finder");
    }

    #[test]
    fn linux_names() {
        assert_eq!(program_name("chrome", "Google-chrome", false), "Google Chrome");
        assert_eq!(program_name("gnome-terminal-server", "Gnome-terminal", false), "Terminal");
        // `/usr/lib/libreoffice/program/soffice.bin` has the file stem `soffice`.
        assert_eq!(program_name("soffice", "libreoffice-writer", false), "LibreOffice");
        assert_eq!(program_name("code", "Code", false), "Visual Studio Code");
        assert_eq!(program_name("", "", false), UNKNOWN_APP);
    }

    #[test]
    fn title_cleaning_variants() {
        // Edge puts a zero-width space in its own name.
        assert_eq!(clean_title("Inbox - Work - Microsoft\u{200B} Edge", "Microsoft Edge", &[]), "Inbox - Work");
        assert_eq!(clean_title("Book1 - Excel", "Microsoft Excel", &["EXCEL"]), "Book1");
        assert_eq!(clean_title("main.rs - pms - Visual Studio Code", "Visual Studio Code", &["Code"]), "main.rs - pms");
        assert_eq!(clean_title("Mozilla Firefox", "Mozilla Firefox", &[]), "");
        assert_eq!(clean_title("New Tab — Mozilla Firefox", "Mozilla Firefox", &[]), "New Tab");
        assert_eq!(clean_title("Report.docx", "Microsoft Word", &[]), "Report.docx");
        assert_eq!(clean_title("  ", "Notepad", &[]), "");
        // Window title is never used as the program.
        assert_eq!(clean_title("Untitled - Notepad", "Notepad", &["notepad"]), "Untitled");
    }

    fn at(s: u32) -> DateTime<Local> {
        Local.with_ymd_and_hms(2026, 11, 14, 10, 0, 0).unwrap() + chrono::Duration::seconds(s as i64)
    }

    fn w(app: &str, title: &str) -> Option<WindowInfo> {
        Some(WindowInfo { app: app.into(), title: title.into() })
    }

    #[test]
    fn usage_sessions_split_on_change_and_drain() {
        let mut t = UsageTracker::default();
        t.observe(w("Google Chrome", "A"), at(0));
        t.observe(w("Google Chrome", "A"), at(5));
        t.observe(w("Google Chrome", "B"), at(10));
        t.observe(w("Slack", "general"), at(25));
        let recs = t.drain(at(60));
        assert_eq!(recs.len(), 3);
        assert_eq!((recs[0].url.as_str(), recs[0].seconds()), ("A", 10));
        assert_eq!((recs[1].url.as_str(), recs[1].seconds()), ("B", 15));
        assert_eq!((recs[2].app.as_str(), recs[2].seconds()), ("Slack", 35));
        // Current window continues from the drain point.
        let recs = t.finish(at(70));
        assert_eq!(recs.len(), 1);
        assert_eq!(recs[0].seconds(), 10);
        assert!(t.finish(at(80)).is_empty());
    }

    #[test]
    fn payload_masking() {
        let recs = vec![UsageRecord { app: "Google Chrome".into(), url: "Docs".into(), start: at(0), end: at(30) }];
        assert!(usage_payload(&recs, 1, TrackApps::Off).is_none());
        let both = usage_payload(&recs, 9, TrackApps::Both).unwrap();
        assert_eq!(both[0]["appName"], "Google Chrome");
        assert_eq!(both[0]["url"], "Docs");
        assert_eq!(both[0]["durationSeconds"], 30);
        assert_eq!(both[0]["timeLogId"], 9);
        assert_eq!(usage_payload(&recs, 9, TrackApps::AppsOnly).unwrap()[0]["url"], "Restricted");
        assert_eq!(usage_payload(&recs, 9, TrackApps::UrlsOnly).unwrap()[0]["appName"], "Restricted");
        assert!(usage_payload(&[], 9, TrackApps::Both).is_none());
    }
}
