#!/bin/bash
# macOS 私有工具安装器：下载并校验固定版本 CMake/Ninja，仅安装到项目目录。
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

# Project-private tools; invoke inside rtl-macos bootstrap or natively.
# 启用严格错误处理。
set -euo pipefail
# 根据脚本位置解析仓库根目录。
ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
# 拒绝非 macOS ARM64 平台。
[[ "$(uname -s)-$(uname -m)" == Darwin-arm64 ]] || { echo 'macOS ARM64 required' >&2; exit 1; }
# 定义项目私有工具安装目录。
DEST="$ROOT/.sandbox/deps/tools"
# 创建工具入口和下载缓存目录。
mkdir -p "$DEST/bin" "$DEST/downloads"
# 使用已选开发工具链的 Python，避免调用系统 Python shim。
PYTHON="${DEVELOPER_DIR:-$(xcode-select -p)}/usr/bin/python3"
# 将版本文件和安装目录传给内嵌 Python，开始工具安装。
"$PYTHON" - "$ROOT/tools/deps/macos-versions.json" "$DEST" <<'PY'
# 导入哈希、JSON、路径、下载子进程和归档处理库。
import hashlib,json,pathlib,subprocess,sys,tarfile,zipfile
# 加载固定版本清单并解析工具目标目录。
versions=json.load(open(sys.argv[1]));root=pathlib.Path(sys.argv[2])
# 依次准备 CMake 归档和 Ninja wheel。
for name,filename in [('cmake','cmake.tar.gz'),('ninja','ninja.whl')]:
 # 确定当前工具的下载缓存文件路径。
 archive=root/'downloads'/filename
 # 仅在缓存不存在时下载。
 if not archive.exists():
  # 使用临时扩展名保存尚未完成的下载。
  partial=archive.with_suffix('.part')
  # 调用 curl 下载固定 URL，设置重试、连接和总超时。
  subprocess.run(['curl','-fsSL','--retry','3','--connect-timeout','30','--max-time','300','-o',str(partial),versions[name+'Url']],check=True)
  # 下载成功后重命名为正式缓存文件。
  partial.rename(archive)
 # 对完整下载文件计算 SHA-256 并比较固定值。
 if hashlib.sha256(archive.read_bytes()).hexdigest()!=versions[name+'Sha256']:
  # 哈希不符时终止，不解压或执行该文件。
  raise SystemExit('SHA-256 mismatch: '+name)
 # 进入 CMake 安装分支。
 if name=='cmake':
  # 根据固定版本拼接 CMake 解压目录名。
  folder='cmake-'+versions['cmakeVersion']+'-macos-universal'
  # 安装目录不存在时才解压。
  if not (root/folder).exists():
   # 打开已经校验的 tar 归档并解压到工具目录。
   with tarfile.open(archive) as t: t.extractall(root)
  # 依次建立 cmake、ctest 和 cpack 的便捷入口。
  for tool in ['cmake','ctest','cpack']:
   # 计算当前工具入口的符号链接路径。
   link=root/'bin'/tool
   # 移除旧的符号链接以便更新入口。
   if link.is_symlink(): link.unlink()
   # 创建指向 CMake 应用包内可执行文件的相对链接。
   link.symlink_to('../'+folder+'/CMake.app/Contents/bin/'+tool)
 # 进入 Ninja 安装分支。
 else:
  # 打开已经校验的 wheel ZIP 文件。
  with zipfile.ZipFile(archive) as z:
   # 寻找 wheel 内的 Ninja 原生可执行文件。
   entry=next(n for n in z.namelist() if n.endswith('/scripts/ninja'))
   # 将 Ninja 二进制提取到项目工具入口目录。
   (root/'bin/ninja').write_bytes(z.read(entry))
  # 赋予 Ninja 所有者读写执行及其他用户读执行权限。
  (root/'bin/ninja').chmod(0o755)
# 结束内嵌 Python 安装程序。
PY
# 打印 CMake 版本以确认可执行。
"$DEST/bin/cmake" --version
# 打印 Ninja 版本以确认可执行。
"$DEST/bin/ninja" --version
