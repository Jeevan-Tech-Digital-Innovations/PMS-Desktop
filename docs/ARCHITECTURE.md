# PMS Desktop 2 (Tauri): architecture and contract

PMS Desktop is a tray time-tracking agent. The employee signs in, picks an **existing** project → task → sub-task →
sub-sub-task, and starts the timer. While a timer runs, the agent sends heartbeats, screenshots and app usage to PMS-API.
**Platforms: Windows and Ubuntu** (22.04+, GNOME). The macOS code paths still compile but are not built or shipped.

It replaces the Electron app (removed; see git history before this branch for its code).

```
React screen (src/, TS, CSS Modules, PMS design tokens)
   │  invoke(command) / listen(event)          ← this file is the contract
Rust core (src-tauri/src/)
   ├─ config.rs    build/runtime config (API + Axis URLs, dev auto sign-in)
   ├─ auth.rs      Axis mobile login/refresh/logout, company switch, keychain
   ├─ api.rs       PMS-API client (token stays in Rust; UI never sees it)
   ├─ timer.rs     timer state machine, heartbeat 30s, active-timer poll 30s, overtime
   ├─ tracker/     idle.rs · screenshot.rs · apps.rs · power.rs (sleep/lock) · linux.rs (X11/D-Bus)
   ├─ queue.rs     offline queue on disk with backoff
   ├─ settings.rs  employee tracking settings cache (15 min)
   ├─ tray.rs      tray menu + state icons
   └─ commands.rs  every #[tauri::command] below
```

## 1. Config

### Channels

| | Staging | Production |
|---|---|---|
| URLs (compiled in by CI) | `stagingpmsapi` / `stagingaxisapi` / `stagingpms` `.enjev.com` | `pmsapi` / `axisapi` / `pms` `.enjev.com` |
| `productName` | PMS Desktop Staging | PMS Desktop |
| `identifier` | `com.jeevantech.pms.desktop.staging` | `com.jeevantech.pms.desktop` |
| Tauri config | `tauri.conf.json` + `tauri.staging.conf.json` (`--config`) | `tauri.conf.json` |

`build.rs` reads `identifier` and `productName` after the overlay (the Tauri CLI passes it in `TAURI_CONFIG`) and compiles
them in as `config::APP_IDENTIFIER` / `config::PRODUCT_NAME`. Everything per-install keys off the identifier: the keychain
service, the data folder `<OS data dir>/<identifier>/` (queue, first-run flag, device-id fallback; Tauri's app data and
log folders use the same identifier), the single-instance lock and the autostart entry (product name). Staging and
production therefore install side by side and never share a session.

### Variables

Read at startup from environment variables (dev) with compile-time defaults (release, via `option_env!`):

| Variable | Dev value | Meaning |
|---|---|---|
| `PMS_API_URL` | `http://localhost:8080/api/v1` (release default: `https://stagingpmsapi.enjev.com/api/v1`) | PMS-API base |
| `AXIS_API_URL` | `https://stagingaxisapi.enjev.com` | Axis identity base (paths below add `/api/v1/auth/...`) |
| `PMS_WEB_URL` | `https://stagingpms.enjev.com` | "Open PMS" target |
| `PMS_DEV_EMAIL` / `PMS_DEV_PASSWORD` | from the shell | **Debug builds only**: sign in automatically at start-up. Ignored in release builds. |
| `PMS_DEV_FAST` | `1` to enable | **Debug builds only**: idle 30 s instead of 5 min, auto-stop 2 min instead of 60, screenshot every 60 s, overtime at 3 min. |
| `PMS_SELFTEST_HEADLESS` | `1` to enable | `--selftest` only: failing desktop steps (screenshot, active window, idle) are SKIP instead of FAIL. Used by CI. |

## 2. Axis (identity) — JSON is **snake_case**

Every HTTP request (Axis and PMS-API) must send `User-Agent: PMS-Desktop/<version> (<os>)`. Cloudflare in front of staging
returns `403 error code: 1010` for library default user agents.

| Call | Request | Response |
|---|---|---|
| `POST {AXIS}/api/v1/auth/mobile/authenticate` | `{email, password, device_id, device_name, platform}` | `{access_token, refresh_token, expires_in (s, 900), active_tenant_id, user{id,email,first_name,last_name,display_name,avatar_url}, memberships[{tenant_id, tenant_name, slug, status, apps_enabled}], roles, permissions, active_orgs}` |
| `POST {AXIS}/api/v1/auth/mobile/refresh` | `{refresh_token, device_id}` | same as authenticate; **refresh token rotates**, so only one refresh in flight |
| `POST {AXIS}/api/v1/auth/mobile/logout` | `{refresh_token}` | 204 |
| `POST {AXIS}/api/v1/auth/switch-tenant` | Bearer access token, `{tenant_id}` | `{access_token, active_tenant_id, roles, permissions, active_orgs, expires_in}`; Axis remembers the choice, so later refreshes stay on that company |

- `device_id`: a UUID generated once per install and stored. `device_name`: the computer name. `platform`: `"windows"` /
  `"linux"` (`"macos"` in dev builds on a Mac).
- Refresh token + device id live in the OS keychain (`keyring` crate; service = the app identifier, see section 1):
  Windows Credential Manager, Linux Secret Service (GNOME Keyring). If the keychain refuses a write (no Secret Service
  running), the value is held in memory for this run only and the employee signs in again next start; the refresh token
  is never written to a file. The device id (not a secret) also gets a file copy in the data folder in that case. The
  access token is kept in memory.
- Refresh 60 s before expiry, and once on any 401 from PMS-API (then retry the call once). If refresh returns 400/401/403, sign out.

## 3. PMS-API calls used (`{API}` = `PMS_API_URL`; JSON camelCase; Bearer access token)

Response shapes: see `src-tauri/src/api.rs`; many wrap data in `{data: ...}`.

| Purpose | Call |
|---|---|
| Profile + tracking settings | `GET /employees/me` → `data.{screenshotTimer ("5min."/"10min."/"15min."), screenshotBlur ("On"/"Off"), screenshotNotifications ("Enable"/"Disable"), trackAppsUrls ("OFF"/"Track Apps only"/"Track URLs only"/"Track Apps & URLs both"), idleNotesSetting, trackingScenario ("Visible"/"Silent")}` |
| Projects (assigned) | `GET /projects` |
| Tasks of a project | `GET /projects/{projectId}/tasks` |
| Sub-tasks (also sub-sub) | `GET /tasks/{taskId}/subtasks` |
| Start | `POST /tasks/{taskId}/time-logs/start` |
| Stop | `PUT /tasks/{taskId}/time-logs/end` |
| State change | `POST /tasks/{taskId}/time-logs/transition` `{newState: ACTIVE_PRODUCTIVE \| PRODUCTIVE_PAUSE \| AWAY \| IDLE \| OVERTIME, effectiveTime}` → new/updated time log |
| Active timer | `GET /tasks/time-logs/active` |
| Today totals | `GET /tasks/time-logs/accumulated-today`, `/accumulated-break-today`, `/tasks/{taskId}/time-logs/accumulated-today` |
| Recent tasks | `GET /tasks/time-logs` (latest distinct tasks) |
| Heartbeat (**required**: server ends timers with no heartbeat for 15 min) | `PUT /tasks/time-logs/{timeLogId}/heartbeat` every 30 s |
| Breaks | `GET /breaks/reasons`, `POST /tasks/time-logs/{timeLogId}/breaks/start` `{breakReasonId}`, `PUT /tasks/time-logs/{timeLogId}/breaks/stop` |
| Idle note | `POST /tasks/time-logs/{timeLogId}/notes` `{noteText}` (1–120 chars) |
| Screenshot | `POST /screenshots/upload/{timeLogId}` multipart: `file` (JPEG), `capturedAt`, `keyboardActivityPercent`, `mouseActivityPercent`, `activeWindowTitle` |
| App usage | `POST /activity/apps/bulk` `[{appName, url, startTime, endTime, durationSeconds, timeLogId}]` |

**Times sent to the API**: ISO-8601 **with offset** (e.g. `2026-11-14T18:04:00+05:30`). The API is being changed to accept
offsets and convert to IST; until that lands it also accepts local `YYYY-MM-DDTHH:mm:ss`. One helper (`time::api_ts`) owns this
(`time::SEND_OFFSET` switches formats). Times the API *returns* (`startTime`, …) have no offset and are IST wall time.

**App usage fields (fixes the Chrome grouping bug):** `appName` is always the **program** (from the OS process: e.g.
`Google Chrome`, `Microsoft Edge`, `Visual Studio Code`, `Microsoft Excel`), never a window title. `url` is the window title
with the program suffix removed (`"Dashboard ‹ SIMTA Astrix — WordPress - Google Chrome"` → `"Dashboard ‹ SIMTA Astrix — WordPress"`).
`trackAppsUrls` masking: "Track Apps only" → `url = "Restricted"`; "Track URLs only" → `appName = "Restricted"`; "OFF" → send nothing.

## 4. Commands (`invoke`) — names and payloads are fixed

All return `Result<T, AppError>` where `AppError = { code: "offline" | "unauthorized" | "server" | "validation" | "busy", message: string }`.

```ts
type Company   = { tenantId: string; name: string; status: string };
type Session   = { user: { id: string; email: string; displayName: string; avatarUrl?: string };
                   companies: Company[]; activeTenantId: string;
                   trackingMode: "visible" | "silent"; firstRunNoticeAccepted: boolean };
type Project   = { id: number; name: string; clientName?: string };
type TaskNode  = { id: number; title: string; status?: string; hasChildren: boolean };
type TaskRef   = { taskId: number; title: string; projectId: number; projectName: string; path: string[] }; // path = breadcrumb titles
type BreakReason = { id: string; reasonText: string; durationLimitMinutes?: number };
type TimerState = "stopped" | "working" | "paused" | "away" | "break" | "idle";
type TimerSnapshot = {
  state: TimerState; timeLogId: number | null; task: TaskRef | null;
  startedAt: string | null;           // ISO of current log
  elapsedSeconds: number;             // current task today (server total + live)
  todayWorkSeconds: number; todayBreakSeconds: number;
  overtime: boolean;
  breakInfo: { reasonText: string; limitSeconds: number | null; startedAt: string } | null;
  queued: number;                     // items waiting in the offline queue
  online: boolean;
};
```

| Command | Args | Returns |
|---|---|---|
| `get_session` | – | `Session \| null` |
| `sign_in` | `{ email, password }` | `Session` |
| `sign_out` | – | `void` (stops the timer first if running) |
| `accept_first_run_notice` | – | `void` |
| `switch_company` | `{ tenantId }` | `Session` (error `busy` if a timer is running) |
| `list_projects` | – | `Project[]` |
| `list_tasks` | `{ projectId }` | `TaskNode[]` |
| `list_subtasks` | `{ taskId }` | `TaskNode[]` |
| `search_tasks` | `{ query }` | `TaskRef[]` (searches a cached index of all assigned tasks, max 30) |
| `recent_tasks` | – | `TaskRef[]` (max 5) |
| `get_timer` | – | `TimerSnapshot` |
| `start_timer` | `{ task: TaskRef }` | `TimerSnapshot` (stops any running log first) |
| `pause_timer` / `resume_timer` / `away_timer` / `stop_timer` | – | `TimerSnapshot` |
| `list_break_reasons` | – | `BreakReason[]` |
| `start_break` | `{ reasonId }` | `TimerSnapshot` |
| `end_break` | – | `TimerSnapshot` |
| `submit_idle_note` | `{ text }` | `void` |
| `overtime_decision` | `{ continueOvertime: boolean }` | `TimerSnapshot` |
| `open_pms_web` | – | `void` |
| `app_info` | – | `{ version: string; platform: "windows" \| "linux" \| "macos"; apiUrl: string; dev: boolean; linuxSession: "x11" \| "wayland" \| null }` |

`linuxSession` comes from `XDG_SESSION_TYPE`, else `WAYLAND_DISPLAY` / `DISPLAY`; `null` on Windows. On `"wayland"` the
screen shows a one-time dismissible notice (UI-only flag in `localStorage`): "For full tracking on Ubuntu, choose
“Ubuntu on Xorg” at the login screen (gear icon)."

## 5. Events (`listen`)

| Event | Payload | When |
|---|---|---|
| `timer:changed` | `TimerSnapshot` | any state change, and every 1 s while running (UI never counts time itself) |
| `session:changed` | `Session \| null` | sign in/out, company switch, forced sign-out |
| `idle:started` | `{ idleSeconds: number; note: "off" \| "optional" \| "mandatory" }` | 5 min without input (visible mode only shows UI) |
| `idle:ended` | `{ resumed: boolean }` | input returned |
| `overtime:prompt` | `{}` | 8 h of work reached (visible mode) |
| `toast` | `{ kind: "info" \| "success" \| "warning" \| "error"; message: string }` | short feedback |
| `navigate` | `{ to: "picker" \| "timer" }` | tray "Choose another task…" |

## 6. Rules carried over from the Electron app (keep exactly)

- **Idle:** no keyboard/mouse input for 5 min (system idle time) → transition `IDLE` on the server and subtract those 5 min
  from work time; show the idle note per `idleNotesSetting` (match case-insensitively: "disabled" → off, contains
  "not mandatory" → optional, "mandatory" → mandatory). Input returns → transition `ACTIVE_PRODUCTIVE` (if that fails, start a
  new log on the same task) and toast "Tracking resumed". 60 min idle → stop the timer and notify.
- **Breaks:** reasons from the API with `durationLimitMinutes`; fallback limit by name (tea/coffee/snack 15 min,
  lunch/dinner/meal 30 min); warn once when the limit passes. Capture and idle detection pause during a break.
- **Overtime:** at 8 h of work → prompt "Continue as overtime?" → `OVERTIME` transition, or stop.
- **Sleep/lock:** detected by a 5 s loop (clock jump > 30 s = slept; lock = idle rising / OS session lock where available) →
  send a heartbeat immediately, pause capture, re-check the active timer on wake. OS lock: Windows = input desktop not
  openable; Linux = `org.gnome.ScreenSaver.GetActive` (session bus), else systemd-logind `LockedHint` of the session
  (system bus). No answer counts as "not locked".
- **Web timers:** the 30 s active-timer poll picks up a timer started in the web app and starts tracking; if the server
  says no timer, stop tracking (15 s grace after a local start).

## 7. Tracking

Platform sources:

| | Windows | Ubuntu, Xorg session | Ubuntu, Wayland session |
|---|---|---|---|
| Idle time | `GetLastInputInfo` | XScreenSaver extension (`x11rb`), else GNOME Mutter | GNOME Mutter `org.gnome.Mutter.IdleMonitor.GetIdletime` (D-Bus) |
| Active window | `active-win-pos-rs` | `active-win-pos-rs` (EWMH `_NET_ACTIVE_WINDOW`, `/proc/<pid>/exe`) | X11 (XWayland) windows only; otherwise app `"Unknown"`, empty title |
| Screenshots | `xcap` (GDI) | `xcap` (X11) | `xcap` via the desktop screenshot portal; may prompt or fail. A failure is logged once per run |
| Tray | Click toggles the window | AppIndicator: click opens the menu; menu item **Open PMS Desktop** | same |

- Screenshots: every `screenshotTimer` minutes (default 10), at a random moment inside each interval; all monitors stitched
  side by side; longest edge ≤ 1920 px; JPEG quality 70; `screenshotBlur = On` → pixelate (downscale ×16 then upscale);
  activity % for the interval = share of 10 s samples with input (keyboard/mouse not distinguished; send the same value in both fields).
- App usage: poll the active window every 5 s; a session closes when the program or title changes; flush every 60 s.
- Offline queue: screenshots and app-usage batches are written to `<app data>/queue/` and retried with backoff
  (5 s → 5 min); cap 500 MB / 7 days; heartbeats are not queued.
- Employee settings: cached 15 min.
- Screenshots, app usage, activity samples and idle detection run only in `working`. Work time accrues in `working` and
  `paused` (the server counts `PRODUCTIVE_PAUSE` as productive), break time in `break`, nothing in `away` / `idle`.

## 8. Tracking mode

| | Visible | Silent |
|---|---|---|
| Window | Opens on tray click and at start-up when signed out | Opens only from the tray |
| Notifications / toasts / idle note / overtime prompt | Yes | None (idle rules still apply silently; overtime continues as overtime) |
| Task choice | Employee picks | Employee picks (no auto-start) |
| Tray | Full menu | Same icon, short menu: Open, Pause/Stop, About, Quit |
| First sign-in | One-time notice: "This computer's activity (screenshots, apps and idle time) is tracked by your company while a timer runs." Must be accepted. | Same |

## 9. Tray menu (visible mode)

```
● Working · <project> · <task>   02:14      (disabled status line)
  Pause | Resume
  Away
  Stop
  Start on ▸  <5 recent tasks> · ─── · Choose another task…
  Switch company ▸ <companies> (disabled while running)
  Open PMS
  Start at login ✓
  Quit                                       (confirms if running)
```

Icon per state: working (teal), paused/away/break (amber), idle (grey), stopped (outline). Left-click toggles the window
next to the tray (Windows). Linux AppIndicator icons send no clicks, so on Linux the menu starts with **Open PMS Desktop**
and the window opens at the top right. Single instance: a second launch focuses the window.

## 10. CI and releases

`.github/workflows/desktop-build.yml`:

| Job | Runner | What |
|---|---|---|
| `checks` | windows-latest | typecheck, frontend tests, `cargo test`, `cargo clippy --all-targets -D warnings` |
| `checks-linux` | ubuntu-22.04 | system packages (`.github/scripts/install-linux-deps.sh`), `cargo test`, clippy |
| `selftest-windows` | windows-latest | `cargo run -- --selftest` against staging with secrets `PMS_STAGING_TEST_EMAIL` / `PMS_STAGING_TEST_PASSWORD` (read-only: no timers, no uploads; skipped with a notice when unset) |
| `build` | via `desktop-bundle.yml` | pull requests (staging) and manual runs (`channel` input): Windows NSIS + Ubuntu deb/AppImage as artifacts |
| `release` | via `desktop-bundle.yml` | push to `build/staging` → pre-release `desktop-staging-v<version>-<run>`; push to `main` → release `desktop-v<version>`; `contents: write` only here |

Repository variables `PMS_API_URL_<CHANNEL>`, `AXIS_API_URL_<CHANNEL>`, `PMS_WEB_URL_<CHANNEL>` (`STAGING` /
`PRODUCTION`) override the default URLs.
