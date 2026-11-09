#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
[[ "${CI:-}" == true ]] || exit 1
mkdir -p state/desktop-install dist/desktop/artifacts
DMG="$(find dist/desktop/forge/make -name '*.dmg' -type f | head -1)"
ZIP="$(find dist/desktop/forge/make -name '*.zip' -type f | head -1)"
[[ -n "$DMG" && -n "$ZIP" ]]
MOUNT="$PWD/state/desktop-install/mount"
mkdir -p "$MOUNT"
hdiutil attach "$DMG" -nobrowse -readonly -mountpoint "$MOUNT"
trap 'hdiutil detach "$MOUNT" >/dev/null 2>&1 || true' EXIT
mkdir -p 'state/desktop-install/应用 程序'
ditto "$MOUNT/RTL Browser.app" 'state/desktop-install/应用 程序/RTL Browser.app'
hdiutil detach "$MOUNT"
trap - EXIT
export RTL_DESKTOP_APP="$PWD/state/desktop-install/应用 程序/RTL Browser.app"
node tools/desktop/audit.mjs "$RTL_DESKTOP_APP"
npm run test:desktop:gui
mkdir -p state/desktop-install/zip
ditto -x -k "$ZIP" state/desktop-install/zip
node tools/desktop/audit.mjs "$PWD/state/desktop-install/zip/RTL Browser.app"
# Only distribution files and a fixed summary are published, never test projects or logs.
cp "$DMG" "$ZIP" dist/desktop/artifacts/
node tools/desktop/checksums.mjs
