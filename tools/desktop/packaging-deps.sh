#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
cd "$(dirname "$0")/../.."
[[ "$(uname -sm)" == 'Darwin arm64' ]] || exit 1
VERSION="$(node -p "JSON.parse(require('fs').readFileSync('tools/deps/versions.json')).nodeVersion")"
DEVELOPER="${DEVELOPER_DIR:-$(/usr/bin/xcode-select -p)}"
for sdk in "$DEVELOPER/SDKs/MacOSX.sdk" "$DEVELOPER/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk"; do
  if [[ -d "$sdk" ]]; then export SDKROOT="$sdk"; break; fi
done
[[ -n "${SDKROOT:-}" ]] || { echo 'Apple SDK missing'; exit 1; }
# Bootstrap uses --ignore-scripts. Build only these DMG helpers, with existing
# Node headers; no download, global install, image mounting or GUI execution.
for module in fs-xattr macos-alias; do
  node node_modules/node-gyp/bin/node-gyp.js rebuild --directory "node_modules/$module" \
    --nodedir="$PWD/.sandbox/deps/node-v$VERSION-darwin-arm64"
done
node -e "require('appdmg'); console.log('DMG native helpers loaded')"
