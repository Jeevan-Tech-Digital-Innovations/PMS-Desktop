# Project structure

```
PMS-Desktop/
├── .github/workflows/
│   └── desktop-build.yml      CI: checks on Windows, installer builds (Windows NSIS, macOS universal DMG)
├── docs/
│   ├── ARCHITECTURE.md        app design, config, command and event contract, tracking rules
│   └── INSTALL.md             installing for employees and IT
├── public/                    static assets served by Vite
├── resources/                 icons used for the app
├── src/                       React frontend (TypeScript, CSS Modules, PMS design tokens)
├── src-tauri/                 Tauri 2 desktop core (Rust)
│   ├── capabilities/          Tauri permission grants for the main window
│   ├── icons/                 app and installer icons
│   ├── src/
│   │   ├── lib.rs             app setup: plugins, tray, command registration
│   │   └── main.rs            binary entry point
│   ├── Cargo.toml             Rust dependencies
│   └── tauri.conf.json        window, bundle (NSIS, DMG) and build settings
├── index.html                 Vite entry page
├── package.json               npm scripts: dev, build, typecheck, test, check
├── tsconfig.json              TypeScript config for the frontend
├── vite.config.ts             Vite config (port 1420, ignores src-tauri)
├── README.md                  setup, environment variables, checks, installers
├── TECH_STACK.md              technologies and versions
└── PROJECT_STRUCTURE.md       this file
```

## Rust core modules (`src-tauri/src/`)

These are the planned modules from [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Each one owns one part of the app.

| Module | Responsibility |
|---|---|
| `config.rs` | Build and runtime config: API and Axis URLs, debug-only dev sign-in |
| `auth.rs` | Axis sign-in, token refresh, sign-out, company switch, keychain |
| `api.rs` | PMS-API client; the access token stays here |
| `timer.rs` | Timer state machine, heartbeat, active-timer poll, overtime |
| `tracker/` | `idle.rs`, `screenshot.rs`, `apps.rs`, `power.rs` (sleep and lock) |
| `queue.rs` | Offline queue on disk with backoff |
| `settings.rs` | Employee tracking settings cache (15 min) |
| `tray.rs` | Tray menu and state icons |
| `commands.rs` | Every `#[tauri::command]` the frontend can call |

## Frontend (`src/`)

Screens and components are React 19 function components. Each has a CSS Module next to it. Colors, spacing and type come
from the PMS design tokens, which define both light and dark themes. The frontend talks to Rust only through `invoke`
(commands) and `listen` (events), using the names and payloads in ARCHITECTURE.md.

## Build outputs (git-ignored)

- `dist/`: Vite build output, loaded by the Tauri window in release builds
- `src-tauri/target/`: Rust build output; installers are in `src-tauri/target/release/bundle/` (or `.../<target>/release/bundle/` for universal macOS builds)
