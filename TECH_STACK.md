# Tech stack

PMS Desktop is a Tauri 2 app: a React screen running in the system WebView, backed by a Rust core that owns all network
calls, tokens, timers and OS access. The UI never sees the access token.

## Frontend (`src/`)

| Area | Choice |
|---|---|
| UI | React 19 (`react`, `react-dom` 19.1) |
| Language | TypeScript (`~6.0`), `strict` typecheck via `npm run typecheck` |
| Build and dev server | Vite 8 with `@vitejs/plugin-react`; dev server on port 1420 |
| Styling | CSS Modules, PMS design tokens (CSS custom properties) with light and dark themes |
| Tauri bridge | `@tauri-apps/api` 2 (`invoke` for commands, `listen` for events) |
| Tests | Vitest (`npm test`) |

The frontend is a view only. It calls Rust commands and renders the `TimerSnapshot` and `Session` it receives. It does not
count time or hold credentials.

## Desktop core (`src-tauri/`)

| Area | Choice |
|---|---|
| Framework | Tauri 2 (`tauri` 2) with `tauri-build` |
| Language | Rust, edition 2024 |
| Core modules | `config`, `auth`, `api`, `timer`, `tracker` (idle, screenshot, apps, power), `queue`, `settings`, `tray`, `commands` |
| Secure storage | OS keychain via the `keyring` crate (refresh token and device id) |
| Packaging | Windows NSIS installer (per-user, WebView2 bootstrapper); macOS `.dmg`, universal binary |

Module layout and the command and event contract are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Tauri plugins

| Plugin | Used for |
|---|---|
| `single-instance` | A second launch focuses the existing window |
| `autostart` | "Start at login" option in the tray menu |
| `notification` | Idle and overtime notices (visible mode only) |
| `positioner` | Places the window next to the tray icon |
| `opener` | "Open PMS" in the default browser |

## Build and CI

| Area | Choice |
|---|---|
| Node | 22 (`npm ci`) |
| Rust | stable toolchain; `swatinem/rust-cache` |
| CI | GitHub Actions, `.github/workflows/desktop-build.yml`: typecheck, tests, `cargo test`, `cargo clippy -D warnings`, then installer builds |
| Installer builds | `tauri-apps/tauri-action@v0`, no release published; artifacts uploaded |
| Code signing | None. Windows installers show the SmartScreen prompt; macOS needs first-launch approval. See [docs/INSTALL.md](docs/INSTALL.md). |
| Config | Compile-time via `option_env!`: `PMS_API_URL`, `AXIS_API_URL`, `PMS_WEB_URL` |
