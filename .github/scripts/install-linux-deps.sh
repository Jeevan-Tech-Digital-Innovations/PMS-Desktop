#!/usr/bin/env bash
# System packages needed to build PMS Desktop on Ubuntu 22.04+ (CI and developer machines).
set -euo pipefail

packages=(
  # Tauri (WebKitGTK window, tray, icons, AppImage)
  build-essential pkg-config file patchelf
  libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev
  # D-Bus: tao, keyring (Secret Service), idle time and screen lock
  libdbus-1-dev
  # xcap screenshots: X11 (xcb + RandR), Wayland portal (PipeWire, bindgen needs clang), wlroots (GBM/EGL)
  libxcb1-dev libxcb-randr0-dev
  libpipewire-0.3-dev libspa-0.2-dev clang libclang-dev
  libwayland-dev libgbm-dev libegl-dev
)

sudo apt-get update
sudo apt-get install -y --no-install-recommends "${packages[@]}"
