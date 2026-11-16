#!/usr/bin/env bash
# System packages needed to build PMS Desktop on Ubuntu 22.04+ (CI and developer machines).
set -euo pipefail

packages=(
  # Tauri (WebKitGTK window, tray, icons, AppImage)
  build-essential pkg-config file patchelf
  libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev
  # D-Bus: tao, keyring (Secret Service), idle time and screen lock
  libdbus-1-dev
  # Active window (active-win-pos-rs uses libxcb). Screenshots and idle use pure-Rust x11rb: no PipeWire needed.
  libxcb1-dev
)

sudo apt-get update
sudo apt-get install -y --no-install-recommends "${packages[@]}"
