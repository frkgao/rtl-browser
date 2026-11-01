// macOS 沙箱输入回归：在真实示例目录验证只读源码、可写状态以及 API 打开和编译流程。
// Regression: open and compile real, read-only examples with writable .rtlb.
// 导入严格断言接口。
import assert from 'node:assert/strict';
// 导入文件访问检查接口。
import fs from 'node:fs';
// 导入路径拼接接口。
import path from 'node:path';
// 导入服务子进程启动接口。
import { spawn } from 'node:child_process';
// 导入等待单次进程退出事件的辅助函数。
import { once } from 'node:events';
// 以当前工作目录作为仓库根目录。
const root = process.cwd();
// 使用当前私有 Node 启动独立服务，捕获输出且不接收标准输入。
const server = spawn(process.execPath, ['dist/server/apps/server/src/main.js'], { stdio: ['ignore', 'pipe', 'pipe'] });
// 初始化服务标准输出和错误输出缓冲。
let output = '', errors = '';
// 累积服务错误输出以便断言失败时诊断。
server.stderr.on('data', b => errors += b);
// 等待服务输出启动 URL。
const url = await new Promise((resolve, reject) => {
  // 超过十秒未启动则拒绝并包含错误输出。
  const timer = setTimeout(() => reject(Error('server timeout: '+errors)), 10000);
  // 监听服务标准输出的数据块。
  server.stdout.on('data', b => {
    // 累积输出以处理跨数据块的 URL。
    output += b;
    // 从启动器输出中提取完整 URL。
    const m = output.match(/open: (http:\/\/\S+)/);
    // 找到 URL 后取消启动超时并返回 URL。
    if (m) { clearTimeout(timer); resolve(m[1]); }
  // 结束标准输出监听回调。
  });
  // 服务启动出错时拒绝等待。
  server.once('error', reject);
// 结束启动等待 Promise。
});
// 从 URL 中提取回环 origin。
const origin = new URL(url).origin;
// 使用启动令牌请求会话，保留重定向响应。
const boot = await fetch(url, { redirect: 'manual' });
// 从响应中提取会话 Cookie。
const cookie = boot.headers.get('set-cookie').split(';')[0];
// 携带 Cookie 读取会话和 CSRF 令牌。
const session = await fetch(origin+'/api/session', {headers:{cookie}}).then(r=>r.json());
// 组装后续 API 请求的认证、来源和 JSON 请求头。
const headers = {cookie, origin, 'content-type':'application/json', 'x-rtl-csrf':session.data.csrfToken};
// 定义带认证的 API 请求辅助函数。
async function api(method, route, body) {
 // 序列化可选请求体，发送请求并解析 JSON 响应。
 const result = await fetch(origin+route, {method,headers,body:body===undefined?undefined:JSON.stringify(body)}).then(r=>r.json());
 // 断言 API 成功并返回数据字段。
 assert.equal(result.ok,true,JSON.stringify(result));return result.data;
// 结束 API 辅助函数。
}
// 开始回归测试，确保最终关闭服务。
try {
 // 依次验证两个真实示例及其顶层模块。
 for (const [name,top] of [['axi-crossbar','axi_crossbar'],['pulp-axi','pulp_axi_xbar_top']]) {
  // 构造示例工程的绝对路径。
  const dir=path.join(root,'examples',name);
  // 验证目录可通过应用要求的 W_OK 检查。
  fs.accessSync(dir,fs.constants.W_OK);
  // 断言沙箱拒绝在示例目录新增源码文件。
  assert.throws(()=>fs.writeFileSync(path.join(dir,'sandbox-source-probe'),'x'),{code:'EPERM'});
  // 断言沙箱拒绝以追加模式打开现有 filelist。
  assert.throws(()=>fs.openSync(path.join(dir,'design.f'),'a'),{code:'EPERM'});
  // 通过真实 API 打开当前示例工程。
  await api('POST','/api/workspace/open',{path:dir});
  // 创建使用 design.f 和显式顶层模块的工程配置。
  const created=await api('POST','/api/projects',{config:{inputMode:'filelist',filelistPath:'design.f',topMode:'explicit',topModule:top,defines:[],includeRoots:[],libraries:[],parameters:[],language:'1800-2017',singleUnit:false,threads:1,warningAsError:false,warningOptions:[]}});
  // 取得服务返回的工程标识。
  const id=created.project.projectId;
  // 按配置版本提交唯一构建请求。
  const job=await api('POST',`/api/projects/${id}/build`,{configRevision:created.config.revision??1,requestKey:'macos-input-'+Date.now()});
  // 声明构建任务的最新状态。
  let result;
  // 最多轮询三百次，避免测试无限等待。
  for(let i=0;i<300;i++) {
   // 查询当前构建任务状态。
   result=await api('GET',`/api/projects/${id}/jobs/${job.jobId}`);
   // 任务到达完成、失败或取消终态时停止轮询。
   if(['COMPLETE','FAILED','CANCELLED'].includes(result.state))break;
   // 非终态时等待一百毫秒再查询。
   await new Promise(r=>setTimeout(r,100));
  // 结束状态轮询。
  }
  // 断言构建完成，失败时附上任务和服务日志。
  assert.equal(result.state,'COMPLETE',JSON.stringify(result)+'\n'+errors);
  // 打印当前示例通过结果。
  console.log(name+': open and compile PASS; source remains read-only');
 // 结束两个示例的验证循环。
 }
// 进入无论测试成功失败均执行的清理分支。
} finally {
 // 调用服务退出 API 正常关闭本次测试服务。
 await api('POST','/api/app/exit',{});
 // 若服务尚未退出，则等待退出事件。
 if(server.exitCode===null)await once(server,'exit');
// 结束清理分支。
}
