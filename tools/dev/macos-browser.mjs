// macOS 浏览器定位器：输出当前 Playwright 固定版本的 ARM64 headless shell 路径。
// Copyright 2026 Frank Gao
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Resolve the pinned headless shell without changing shared UI test behavior.
// 导入文件系统接口以读取清单和检查文件。
import fs from 'node:fs';
// 导入跨平台路径拼接接口。
import path from 'node:path';
// 导入 ES 模块中使用 CommonJS 解析器的适配函数。
import { createRequire } from 'node:module';
// 基于当前模块位置创建依赖解析器。
const require = createRequire(import.meta.url);
// 定位已安装的 playwright-core 包根目录。
const root = path.dirname(require.resolve('playwright-core/package.json'));
// 读取当前 Playwright 包附带的浏览器版本清单。
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'browsers.json'), 'utf8'));
// 选择 Chromium headless shell 的固定修订版本。
const browser = manifest.browsers.find(b => b.name === 'chromium-headless-shell');
// 拼接项目私有 ARM64 headless shell 可执行文件路径。
const executable = path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, `chromium_headless_shell-${browser.revision}`, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell');
// 缺少浏览器时提示先执行下载命令并失败退出。
if (!fs.existsSync(executable)) throw new Error('Browser missing; run tools/macos.sh browser');
// 向调用方输出可执行路径供 RTL_CHROMIUM 使用。
console.log(executable);
