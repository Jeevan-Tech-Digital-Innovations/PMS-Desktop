# PMS Desktop

PMS Desktop is a tray time-tracking agent for PMS. The employee signs in, picks an existing project, task and sub-task,
and starts the timer. While a timer runs, the app sends heartbeats, screenshots and app usage to PMS-API.

It is built with Tauri 2: a React 19 screen in `src/` and a Rust core in `src-tauri/`. It runs on **Windows** and
**Ubuntu** (22.04+). The macOS code still compiles for development, but macOS builds are no longer shipped.

- [Architecture and contract](docs/ARCHITECTURE.md): config, commands, events, tracking rules.
- [Installing](docs/INSTALL.md): installer steps for employees and IT.
- [Tech stack](TECH_STACK.md) and [project structure](PROJECT_STRUCTURE.md).

## Development setup

Requirements:

- **Node.js 22**
- **Rust** (stable)
- **Windows:** Microsoft C++ Build Tools (the "Desktop development with C++" workload). WebView2 is included in Windows 11.
- **Ubuntu:** the system packages in [`.github/scripts/install-linux-deps.sh`](.github/scripts/install-linux-deps.sh)
  (WebKitGTK 4.1, AppIndicator, D-Bus and libxcb). Run the script once.
- **macOS (development only):** Xcode Command Line Tools (`xcode-select --install`)

Install Rust:

- **macOS (Homebrew):**
  ```sh
  brew install rustup
  export PATH="/opt/homebrew/opt/rustup/bin:$PATH"   # Intel Macs: /usr/local/opt/rustup/bin
  rustup-init -y
  ```
- **Windows / Ubuntu:** install from https://rustup.rs and accept the defaults.

Run the app:

```sh
npm install
npm run tauri dev
```

`npm run tauri dev` starts Vite on port 1420 and opens the desktop window.

### Environment variables

Set these in your shell (or a `.env` file, which is git-ignored) before `npm run tauri dev`. In release builds they are
compiled in at build time; CI sets them per channel (see [Release channels](#release-channels)), and a local release
build without them uses the staging defaults shown below.

| Variable | Dev default | Meaning |
|---|---|---|
| `PMS_API_URL` | `http://localhost:8080/api/v1` (release default: `https://stagingpmsapi.enjev.com/api/v1`) | PMS-API base URL |
| `AXIS_API_URL` | `https://stagingaxisapi.enjev.com` | Axis identity base URL (sign-in) |
| `PMS_WEB_URL` | `https://stagingpms.enjev.com` | Target of "Open PMS" |
| `PMS_DEV_EMAIL` / `PMS_DEV_PASSWORD` | unset | Debug builds only: sign in automatically at start-up. Ignored in release builds. |
| `PMS_DEV_FAST` | unset | Set to `1` to enable debug-only fast timings: idle after 30 s, auto-stop after 2 min, screenshot every 60 s, overtime at 3 min. Debug builds only. |
| `PMS_SELFTEST_HEADLESS` | unset | `1`: in `--selftest`, a failing screenshot, active-window or idle step counts as SKIP (CI runners without a desktop). |

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

CI runs the same checks, plus `cargo clippy --all-targets -D warnings`, on Windows and on Ubuntu 22.04 for every pull
request and release (`.github/workflows/desktop-build.yml`).

## Release channels

There are two channels. Each has its own server URLs, app name and app identifier, so both can be installed side by side
and never share a stored sign-in or data folder.

| | Staging | Production |
|---|---|---|
| PMS-API | `https://stagingpmsapi.enjev.com/api/v1` | `https://pmsapi.enjev.com/api/v1` |
| Axis | `https://stagingaxisapi.enjev.com` | `https://axisapi.enjev.com` |
| PMS web | `https://stagingpms.enjev.com` | `https://pms.enjev.com` |
| Product name | PMS Desktop Staging | PMS Desktop |
| Identifier (keychain service, data folder) | `com.jeevantech.pms.desktop.staging` | `com.jeevantech.pms.desktop` |
| Tauri config | `tauri.conf.json` + `--config src-tauri/tauri.staging.conf.json` | `tauri.conf.json` |

`src-tauri/build.rs` reads the identifier and product name after the overlay and compiles them in, so the keychain entry
follows the channel.

## Building installers

Installers are built by CI (`.github/workflows/desktop-build.yml`, bundle jobs in `desktop-bundle.yml`), not on your
machine:

| Event | Channel | Result |
|---|---|---|
| Pull request | staging | Artifacts only |
| Push to `build/staging` | staging | Pre-release `desktop-staging` (one moving pre-release, recreated each time) |
| Push to `main` | production | Release `desktop-v<version>` |
| **Run workflow** (Actions tab) | chosen with the `channel` input | Artifacts only |

Releases are published to the **public** repository `Jeevan-Tech-Digital-Innovations/PMS-Desktop-Releases` (secret
`RELEASES_REPO_TOKEN`); the installed apps update from there. Without that secret, releases are created in this repository
as before (`desktop-v<version>`, `desktop-staging-v<version>-<run number>`) and nothing updates automatically.

Artifacts are named `pms-desktop-<channel>-windows` (the NSIS `.exe`) and `pms-desktop-<channel>-ubuntu` (the `.deb` and
the `.AppImage`). Releases attach the same files.

The production tag has no run number: bump `version` in `src-tauri/tauri.conf.json` (and `Cargo.toml`, `package.json`)
before merging to `main`. Otherwise the build reuses the existing `desktop-v<version>` release, whose tag still points at
the older commit.

### CI jobs

- `checks` (Windows) and `checks-linux` (Ubuntu 22.04): typecheck and frontend tests (Windows), `cargo test`,
  `cargo clippy --all-targets -D warnings`.
- `selftest-windows`: builds the debug binary and runs `cargo run -- --selftest` against **staging**. The self-test is
  read-only: it signs in, reads settings, projects, tasks, the active timer, totals and break reasons, takes one screenshot
  to a temp file and signs out. It starts no timer and uploads nothing. It needs the repository secrets
  `PMS_STAGING_TEST_EMAIL` and `PMS_STAGING_TEST_PASSWORD` (a staging test account); without them the job is skipped
  with a notice.
- `build` (pull requests, manual runs) / `release` (pushes): Windows and Ubuntu installers. Only `release` gets
  `contents: write`.

### Repository settings

| Kind | Name | Needed for |
|---|---|---|
| Secret | `PMS_STAGING_TEST_EMAIL`, `PMS_STAGING_TEST_PASSWORD` | Staging self-test (optional; skipped when unset) |
| Secret | `RELEASES_REPO_TOKEN` | Publishing to the public releases repository: a fine-grained personal access token with **Contents: read and write** on `PMS-Desktop-Releases` only. Absent: releases stay in this repository. |
| Secret | `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Signing update packages (see Auto-update). Absent: no update packages. |
| Variable (or secret) | `UPDATER_PUBKEY` | Public key of that key pair, compiled into the app. Absent: the updater is disabled. |
| Variable | `UPDATER_ENDPOINT_STAGING`, `UPDATER_ENDPOINT_PRODUCTION` | Optional override of the `latest.json` URLs (defaults below). |
| Variable | `RELEASES_REPO`, `RELEASES_REPO_BRANCH` | Optional: another releases repository (default `Jeevan-Tech-Digital-Innovations/PMS-Desktop-Releases`) and its default branch (default `main`). |
| Variable | `PMS_API_URL_STAGING`, `AXIS_API_URL_STAGING`, `PMS_WEB_URL_STAGING` | Optional override of the staging URLs |
| Variable | `PMS_API_URL_PRODUCTION`, `AXIS_API_URL_PRODUCTION`, `PMS_WEB_URL_PRODUCTION` | Optional override of the production URLs |

The older unsuffixed variables (`PMS_API_URL`, …) are no longer read by CI, so they cannot point a production build at
staging.

### Auto-update

From 2.0.1 the app updates itself (policy: [ARCHITECTURE.md section 11](docs/ARCHITECTURE.md); employee view:
[INSTALL.md](docs/INSTALL.md#updates)). One-time setup by the owner:

1. Generate the signing key pair (keep the private key and its password safe; losing it means a manual re-install for everyone):
   ```sh
   npx tauri signer generate -w ~/.tauri/pms-desktop.key
   ```
   It writes `~/.tauri/pms-desktop.key` (private) and `~/.tauri/pms-desktop.key.pub` (public).
2. In this repository's settings add the **secrets** `TAURI_SIGNING_PRIVATE_KEY` (the content of the private key file),
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (the password you chose) and `RELEASES_REPO_TOKEN` (see above), and the
   **variable** `UPDATER_PUBKEY` (the content of the `.pub` file).
3. Make sure `PMS-Desktop-Releases` is public and has at least one commit (for example a README).

Default `latest.json` URLs (compiled in by CI, overridable with `UPDATER_ENDPOINT_*`):

| Channel | URL |
|---|---|
| Production | `https://github.com/Jeevan-Tech-Digital-Innovations/PMS-Desktop-Releases/releases/latest/download/latest.json` |
| Staging | `https://github.com/Jeevan-Tech-Digital-Innovations/PMS-Desktop-Releases/releases/download/desktop-staging/latest.json` |

Without `UPDATER_PUBKEY` or without the signing key the installers still build; the app logs "updater disabled" and does not
update. A build only updates to a **higher** version number, so bump `version` (`Cargo.toml`, `tauri.conf.json`,
`package.json`) for every release you want installed apps to pick up, staging included.

To build locally, run `npm run tauri build` (production identity) or
`npm run tauri build -- --config src-tauri/tauri.staging.conf.json` (staging identity), with the URL variables set for
the channel. Output goes to `src-tauri/target/release/bundle/`.

Installing the app for employees and IT: [docs/INSTALL.md](docs/INSTALL.md).
