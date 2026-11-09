#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$PWD"
[[ "$(uname -sm)" == 'Darwin arm64' ]] || { echo 'Desktop target requires macOS ARM64'; exit 1; }
# This tree never reuses host-targeted slang objects or worker binaries.
BASE="$ROOT/.sandbox/deps"
DEPS="$BASE/desktop-26"
BUILD="$ROOT/build/desktop-26"
mkdir -p "$DEPS" "$BUILD"
for name in sqlite nlohmann; do
  [[ -e "$DEPS/$name" ]] || ln -s "$BASE/$name" "$DEPS/$name"
done
COMMON=(-DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_DEPLOYMENT_TARGET=26.0 -DCMAKE_OSX_ARCHITECTURES=arm64
  "-DCMAKE_C_FLAGS=-ffile-prefix-map=$ROOT=." "-DCMAKE_CXX_FLAGS=-ffile-prefix-map=$ROOT=."
  -DCMAKE_C_COMPILER_LAUNCHER= -DCMAKE_CXX_COMPILER_LAUNCHER=)
FETCH=()
for name in fmt boost_regex tomlplusplus; do
  src="$ROOT/build/slang/_deps/$name-src"
  [[ -d "$src" ]] || { echo "Missing dependency $name; run the dependency bootstrap first"; exit 1; }
  upper="$(echo "$name" | tr '[:lower:]' '[:upper:]')"
  FETCH+=("-DFETCHCONTENT_SOURCE_DIR_$upper=$src")
done
cmake -S "$BASE/slang-src" -B "$BUILD/slang" -G Ninja "${COMMON[@]}" "${FETCH[@]}" \
  -DFETCHCONTENT_FULLY_DISCONNECTED=ON -DCMAKE_INSTALL_PREFIX="$DEPS/slang" \
  -DSLANG_INCLUDE_TESTS=OFF -DSLANG_INCLUDE_TOOLS=OFF -DSLANG_INCLUDE_DOCS=OFF \
  -DSLANG_INCLUDE_PYLIB=OFF -DSLANG_INCLUDE_INSTALL=ON -DSLANG_USE_MIMALLOC=OFF \
  -DSLANG_USE_SYSTEM_FMT=OFF -DSLANG_USE_SYSTEM_BOOST=OFF -DBUILD_SHARED_LIBS=OFF
cmake --build "$BUILD/slang" --target install --parallel "${RTL_BUILD_JOBS:-2}"
COMMIT="$(node -p "JSON.parse(require('fs').readFileSync('tools/deps/versions.json')).slangCommit")"
cmake -S native/index-worker -B "$BUILD/index-worker" -G Ninja "${COMMON[@]}" -DRTL_DEPS_DIR="$DEPS" -DRTL_SLANG_COMMIT="$COMMIT"
cmake --build "$BUILD/index-worker" --parallel "${RTL_BUILD_JOBS:-2}"
cmake -S native/wave-worker -B "$BUILD/wave-worker" -G Ninja "${COMMON[@]}" -DRTL_DEPS_DIR="$DEPS"
cmake --build "$BUILD/wave-worker" --parallel "${RTL_BUILD_JOBS:-2}"
ctest --test-dir "$BUILD/wave-worker" --output-on-failure
npm run typecheck
npm run build
npm run desktop:stage
