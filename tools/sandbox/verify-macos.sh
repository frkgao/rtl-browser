#!/bin/bash
# macOS 隔离探测：创建临时输入，检查文件、环境、子进程和网络边界并保存证据。
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

# 启用严格错误处理，包括管道中的失败。
set -euo pipefail
# 根据脚本位置定位仓库根目录。
ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
# 创建位于项目外的独立临时目录作为隔离探针。
OUTSIDE="$(mktemp -d /private/tmp/rtl-isolation.XXXXXX)"
# 脚本退出时删除本次探针目录。
trap 'rm -rf "$OUTSIDE"' EXIT
# 创建未授权的外部文件用于验证读取被拒绝。
printf 'private\n' > "$OUTSIDE/secret"
# 创建将被显式授权的外部 RTL 输入目录。
mkdir -p "$OUTSIDE/input"
# 写入简单源码样本供只读访问验证。
printf 'rtl\n' > "$OUTSIDE/input/design.sv"
# 创建项目内的隔离证据目录。
mkdir -p "$ROOT/.sandbox/evidence"
# 在离线测试沙箱内运行 Python 探测并将结果保存到证据文件。
"$ROOT/tools/sandbox/rtl-macos" --profile test --network offline --input "$OUTSIDE/input" -- python3 - "$ROOT" "$OUTSIDE" <<'PY' | tee "$ROOT/.sandbox/evidence/isolation-macos.txt"
# 导入环境、路径、网络、子进程和 JSON 接口。
import os,sys,socket,subprocess,json,pathlib
# 解析传入的仓库目录和外部探针目录。
root,outside=map(pathlib.Path,sys.argv[1:])
# 初始化各项探测结果。
checks={}
# 定义要求操作因权限被拒绝的辅助函数。
def denied(name,fn):
 # 尝试执行待验证操作。
 try: fn()
 # 捕获权限拒绝并将此项标记为通过。
 except PermissionError: checks[name]=True
 # 操作意外成功则将此项标记为失败。
 else: checks[name]=False
# 确认沙箱不能追加写入仓库 README。
denied('source_write_denied',lambda: (root/'README.md').open('a'))
# 确认未授权的外部文件不可读取。
denied('outside_read_denied',lambda: (outside/'secret').read_text())
# 确认未授权的外部目录不可写入。
denied('outside_write_denied',lambda: (outside/'write').write_text('x'))
# 启动 cat 子进程，确认子进程同样无法读取外部文件。
checks['child_inherits_restrictions']=subprocess.run(['/bin/cat',str(outside/'secret')],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode!=0
# 依次检查构建目录、私有 HOME 和私有临时目录。
for name,p in [('build',root/'build'),('home',pathlib.Path(os.environ['HOME'])),('tmp',pathlib.Path(os.environ['TMPDIR']))]:
 # 写入并删除探针文件，确认允许目录可写。
 f=p/'isolation-canary';f.write_text('ok');f.unlink();checks[name+'_writable']=True
# 确认显式输入目录通过工程打开所需的 W_OK 检查。
os.access(outside/'input',os.W_OK) or (_ for _ in ()).throw(AssertionError('input directory access check'))
# 确认不能在输入目录新增源码文件。
denied('input_new_source_denied',lambda: (outside/'input/new.sv').write_text('x'))
# 确认可以读取已授权的源码内容。
checks['input_readable']=(outside/'input/design.sv').read_text()=='rtl\n'
# 确认现有输入源码不能以追加模式打开。
denied('input_source_write_denied',lambda: (outside/'input/design.sv').open('a'))
# 创建 .rtlb 并写入状态探针。
state=outside/'input/.rtlb';state.mkdir();(state/'canary').write_text('ok')
# 记录输入状态目录写入成功。
checks['input_state_writable']=True
# 确认宿主 SSH agent 连接变量未被继承。
checks['environment_clean']='SSH_AUTH_SOCK' not in os.environ
# 建立本机 TCP 监听和连接，确认离线模式仍允许回环通信。
s=socket.socket();s.bind(('127.0.0.1',0));s.listen();c=socket.create_connection(s.getsockname());a,_=s.accept();a.close();c.close();s.close();checks['loopback']=True
# 创建具有两秒超时的外网连接探针。
s=socket.socket();s.settimeout(2)
# 尝试连接外部地址的 HTTPS 端口。
try: s.connect(('1.1.1.1',443))
# 仅将明确的权限拒绝视为外网隔离成功。
except PermissionError: checks['external_network_denied']=True
# 普通网络错误不能证明隔离，因此判定失败。
except OSError: checks['external_network_denied']=False
# 外网连接成功说明隔离失败。
else: checks['external_network_denied']=False
# 关闭外网探针套接字。
s.close()
# 输出全部结果，并在任一项失败时触发断言退出。
print(json.dumps(checks,indent=2));assert all(checks.values()),checks
# 结束内嵌 Python 探测程序。
PY
