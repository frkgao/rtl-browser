# 桌面开发与验证

桌面壳使用固定版本的 Electron 和 Electron Forge；React 界面和 HTTP API 与 Web 共享。应用绑定随机 loopback 端口，使用原有会话令牌和 Cookie。后端运行在随包分发的固定版本 Node 中，避免 Electron 的 Node ABI 与 SQLite/query 子进程耦合。

Renderer 禁用 Node，启用 context isolation 和 sandbox；preload 只暴露原生选取、偏好、布局及最近工程操作。主进程校验 IPC 发送窗口与主 frame，阻止外站导航、新窗口和权限请求。原生文件选择仅授权选中的文件，目录选择授权所选目录。没有外部资源加载和自动更新请求。

## 本机：仅项目沙箱、非 GUI

以下命令从仓库根目录执行。所有写入留在项目中；不安装 Homebrew、全局 npm 包，不修改 shell、用户钥匙串或系统设置。首次准备依赖允许联网，后续编译和测试离线。

```sh
./tools/sandbox/rtl-macos --profile bootstrap --network online -- bash tools/deps/bootstrap-macos-tools.sh
./tools/sandbox/rtl-macos --profile bootstrap --network online -- bash tools/deps/bootstrap.sh
./tools/sandbox/rtl-macos --profile build --network offline -- bash tools/build.sh
./tools/sandbox/rtl-macos --profile build --network offline -- npm test
./tools/sandbox/rtl-macos --profile build --network offline -- npm run test:desktop
./tools/sandbox/rtl-macos --profile build --network offline -- npm run desktop:build
```

修改源码和 package-lock 使用 `--profile edit`；依赖缓存、HOME、配置和临时文件由启动器重定向到 `.sandbox`。不要直接运行 Electron 或将应用安装到本机。`desktop:package`、`desktop:make` 和 GUI 测试入口限制为独立 macOS ARM64 CI。

桌面构建单独使用 `build/desktop-26` 和 `.sandbox/deps/desktop-26`，从源码重编 slang 及 worker，设置部署目标 `26.0`，不复用 Web 的原生对象文件。资源暂存于 `dist/desktop/runtime`，按白名单复制 Node、worker、编译后服务、Web、schema 和许可证。暂存检查架构、最低 OS、动态库及构建机器路径。它不会启动 GUI 或挂载 DMG。

## CI：安装包与 GUI

`.github/workflows/desktop-macos.yml` 在独立 `macos-26` ARM64 runner 中完成：

1. 项目沙箱联网下载依赖和固定 Electron 二进制。
2. 项目沙箱用固定 Node 的本地头文件离线编译 DMG 工具辅助模块，然后离线执行 Web 回归、桌面状态测试、macOS 26 原生重编、FST CTest 和资源检查。
3. 断开外部网络，Forge 生成 `.app`、DMG、ZIP，使用 ad-hoc 签名并验证签名。
4. 挂载 DMG，复制应用到中文/空格目录；用包内 Node/worker 和只含系统命令的 PATH 运行桌面测试。测试目录、用户数据和 HOME 均独立。
5. 检查 picker 授权与取消、离线编译和 SQLite 查询、FST、导出、重启持久化、单实例、Dock 恢复、后台崩溃和退出；再检查 ZIP 中应用。
6. 只上传 DMG、ZIP、SHA256SUMS 和固定字段的验证结果，不上传测试工程、波形、用户配置或完整日志目录。没有自动发布 Release 的权限。

GUI 自动化通过替代系统对话框的返回值验证 picker 的 IPC 授权与取消，无法代替真实用户对 macOS 对话框及 Gatekeeper 首次打开体验的人工验收。没有 Apple 开发者身份时，CI 的签名检查只证明包完整，不能证明 Gatekeeper 会直接放行。

`tests/desktop-state.mjs` 验证桌面状态独立、重启与崩溃恢复、文件授权、只读目录和损坏状态保护。`tests/desktop-gui.mjs` 只在 CI 中启动安装后的应用。Web 的 `npm run serve` 与既有 Linux/Windows 工作流保持原路径。
