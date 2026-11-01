#!/bin/bash
# macOS 任务入口：选择项目私有工具，分派依赖准备、构建、浏览器、测试和服务任务。
# Copyright 2026 Frank Gao
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Native macOS entry point; wrap with tools/sandbox/rtl-macos for development.
# 遇到命令失败、未定义变量或管道失败立即退出。
set -euo pipefail
# 根据脚本位置计算仓库绝对路径。
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
# 仅允许 macOS ARM64，其他平台打印错误退出。
[[ "$(uname -s)-$(uname -m)" == Darwin-arm64 ]] || { echo 'macOS ARM64 required' >&2; exit 1; }
# 读取仓库固定的 Node 版本。
VERSION="$(sed -n 's/.*"nodeVersion": "\([^"]*\)".*/\1/p' "$ROOT/tools/deps/versions.json")"
# 优先使用项目私有工具和 macOS Node，仅影响子进程。
export PATH="$ROOT/.sandbox/deps/tools/bin:$ROOT/.sandbox/deps/node-v$VERSION-darwin-arm64/bin:$PATH"
# 将 npm 缓存定向到项目内。
export NPM_CONFIG_CACHE="$ROOT/.sandbox/cache/npm"
# 将 npm 用户配置定向到项目内。
export NPM_CONFIG_USERCONFIG="$ROOT/.sandbox/config/npmrc"
# 将 Playwright 浏览器目录定向到项目内。
export PLAYWRIGHT_BROWSERS_PATH="$ROOT/.sandbox/deps/browser"
# 切换到仓库根目录以便使用相对路径。
cd "$ROOT"
# 读取任务名称并移除该参数，剩余参数交给启动器。
TASK="${1:-help}"; (($# == 0)) || shift
# 按任务名称选择执行入口。
case "$TASK" in
 # 安装项目私有的 CMake 和 Ninja。
 tools) exec /bin/bash tools/deps/bootstrap-macos-tools.sh;;
 # 复用依赖准备脚本安装固定版本依赖。
 bootstrap) exec /bin/bash tools/deps/bootstrap.sh;;
 # 复用构建脚本编译 worker、服务端和 WebUI。
 build) exec /bin/bash tools/build.sh;;
 # 下载 Playwright 固定版本的 Chromium 浏览器。
 browser) exec node node_modules/playwright-core/cli.js install chromium;;
 # 进入仅运行 UI 测试的分支。
 ui)
 # 解析并导出 macOS headless shell 路径。
 export RTL_CHROMIUM="$(node tools/dev/macos-browser.mjs)"
 # 用 Node 执行共用 UI 测试并返回退出状态。
 exec node tests/e2e/ui-core.mjs;;
 # 进入完整测试分支。
 test)
 # 未要求跳过 UI 时才解析测试浏览器。
 if [[ "${RTL_TEST_SKIP_UI:-0}" != 1 ]]; then
  # 导出共用 UI 测试读取的浏览器路径。
  export RTL_CHROMIUM="$(node tools/dev/macos-browser.mjs)"
 # 结束浏览器准备条件分支。
 fi
 # 执行共用测试入口。
 exec /bin/bash tools/test.sh;;
 # 启动已有服务产物并透传服务参数。
 serve) exec node tools/launchers/rtl-browser.mjs serve "$@";;
 # 未知任务打印用法并以状态码 2 退出。
 *) echo 'usage: tools/macos.sh tools|bootstrap|build|browser|test|ui|serve [server options]'; exit 2;;
# 结束任务分派。
esac
