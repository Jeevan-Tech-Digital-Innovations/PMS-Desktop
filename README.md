# PMS Desktop

PMS Desktop is a tray time-tracking agent for PMS. The employee signs in, picks an existing project, task and sub-task,
and starts the timer. While a timer runs, the app sends heartbeats, screenshots and app usage to PMS-API.

It is built with Tauri 2: a React 19 screen in `src/` and a Rust core in `src-tauri/`. Windows is the main platform;
macOS is supported.

- [Architecture and contract](docs/ARCHITECTURE.md): config, commands, events, tracking rules.
- [Installing](docs/INSTALL.md): installer steps for employees and IT.
- [Tech stack](TECH_STACK.md) and [project structure](PROJECT_STRUCTURE.md).

## Development setup

Requirements:

- **Node.js 22**
- **Rust** (stable)
- **Windows:** Microsoft C++ Build Tools (the "Desktop development with C++" workload). WebView2 is included in Windows 11.
- **macOS:** Xcode Command Line Tools (`xcode-select --install`)

Install Rust:

- **macOS (Homebrew):**
  ```sh
  brew install rustup
  export PATH="/opt/homebrew/opt/rustup/bin:$PATH"   # Intel Macs: /usr/local/opt/rustup/bin
  rustup-init -y
  ```
- **Windows:** install from https://rustup.rs and accept the defaults.

Run the app:

```sh
npm install
npm run tauri dev
```

`npm run tauri dev` starts Vite on port 1420 and opens the desktop window.

### Environment variables

Set these in your shell (or a `.env` file, which is git-ignored) before `npm run tauri dev`. In release builds they are
compiled in at build time, with the staging defaults shown below.

| Variable | Dev default | Meaning |
|---|---|---|
| `PMS_API_URL` | `http://localhost:8080/api/v1` (release default: `https://stagingpmsapi.enjev.com/api/v1`) | PMS-API base URL |
| `AXIS_API_URL` | `https://stagingaxisapi.enjev.com` | Axis identity base URL (sign-in) |
| `PMS_WEB_URL` | `https://stagingpms.enjev.com` | Target of "Open PMS" |
| `PMS_DEV_EMAIL` / `PMS_DEV_PASSWORD` | unset | Debug builds only: sign in automatically at start-up. Ignored in release builds. |
| `PMS_DEV_FAST` | unset | Set to `1` to enable debug-only fast timings: idle after 30 s, auto-stop after 2 min, screenshot every 60 s, overtime at 3 min. Debug builds only. |

Do not put real passwords in files that are committed. `PMS_DEV_PASSWORD` is for your own shell session only.

## Checks

```sh
npm run check
```

This runs the TypeScript typecheck, the frontend tests and `cargo test`.

To run only the Rust self-test:

```sh
cargo run --manifest-path src-tauri/Cargo.toml -- --selftest
```

CI runs the same checks, plus `cargo clippy -D warnings`, on every pull request
(`.github/workflows/desktop-build.yml`).

## Building installers

Installers are built by CI, not on your machine. Open the **Desktop build** workflow run for a pull request, or start it
from the Actions tab with **Run workflow**. Download the artifacts from the run:

- `pms-desktop-windows-nsis`: the Windows `.exe` installer
- `pms-desktop-macos-dmg`: the macOS universal `.dmg`

Builds are not published as releases. CI uses the `PMS_API_URL`, `AXIS_API_URL` and `PMS_WEB_URL` repository variables
when they are set, and the staging defaults when they are not.

To build locally, run `npm run tauri build`. Output goes to `src-tauri/target/release/bundle/`.

Installing the app for employees and IT: [docs/INSTALL.md](docs/INSTALL.md).
