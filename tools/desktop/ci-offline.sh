#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
[[ "${CI:-}" == true && "$(uname -sm)" == 'Darwin arm64' ]] || { echo 'Independent macOS ARM64 CI required'; exit 1; }
# CI can access its isolated filesystem and GUI services, but tests/builds cannot
# access external networks. This does not weaken the local development sandbox.
exec /usr/bin/sandbox-exec -p '(version 1)(allow default)(deny network*)(allow network* (local ip "localhost:*") (remote ip "localhost:*"))' "$@"
