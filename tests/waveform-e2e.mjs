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

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { chromium } from "playwright-core";
import { workerExecutable } from "./lib/platform.mjs";

const ROOT = process.env.RTL_PROJECT_ROOT ? path.resolve(process.env.RTL_PROJECT_ROOT) : path.resolve(import.meta.dirname, "..");
const MAIN = path.join(ROOT, "dist", "server", "apps", "server", "src", "main.js");
const WORKER = workerExecutable(ROOT);
const EXAMPLE = path.join(ROOT, "examples", "openllc-256k-rtl-wave");
const STATE = path.join(ROOT, "state", `waveform-${Date.now()}-${process.pid}`);
const PROJECT = path.join(STATE, "openllc-256k-rtl-wave");
const HOST = "127.0.0.1";
const FIXTURE_WRITER = path.join(ROOT, "build", "wave-worker", process.platform === "win32" ? "wave-fixtures.exe" : "wave-fixtures");

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
fs.mkdirSync(STATE, { recursive: true });
fs.cpSync(EXAMPLE, PROJECT, { recursive: true, filter: (src) => path.basename(src) !== ".rtlb" });
const fixtures = path.join(PROJECT,"mismatch-fixtures");
const generated = spawnSync(FIXTURE_WRITER,[fixtures],{encoding:"utf8"});
assert.equal(generated.status,0,generated.stderr || String(generated.error));
fs.writeFileSync(path.join(fixtures,"corrupt.fst"),"not an FST file");

const server = spawn(process.execPath, [
  MAIN, "--workspace", STATE, "--worker", WORKER,
  "--web", path.join(ROOT, "dist", "web"), "--port", "0",
], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, RTL_PROJECT_ROOT: ROOT },
});
let stderr = "";
server.stderr.on("data", (c) => { stderr = (stderr + c.toString()).slice(-20000); });
const urlLine = await new Promise((resolve, reject) => {
  let buf = "";
  const timer = setTimeout(() => reject(new Error(`server did not start\n${stderr}`)), 15000);
  server.stdout.on("data", (c) => {
    buf += c.toString();
    const line = buf.split("\n").find((x) => x.startsWith("open: "));
    if (line) { clearTimeout(timer); resolve(line.slice(6).trim()); }
  });
  server.on("exit", (code) => { if (code !== null) reject(new Error(`server exited ${code}\n${stderr}`)); });
});
const parsed = new URL(urlLine);
const base = `http://${HOST}:${parsed.port}`;
const boot = await fetch(urlLine, { redirect: "manual" });
const cookie = (boot.headers.get("set-cookie") || "").split(";")[0];
async function api(method, p, body, csrf) {
  const headers = { cookie, origin: base };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET") headers["x-rtl-csrf"] = csrf;
  const res = await fetch(`${base}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let j;
  try { j = JSON.parse(text); } catch { throw new Error(`${method} ${p}: ${res.status} ${text.slice(0, 500)}`); }
  if (!j.ok) throw new Error(`${method} ${p}: ${res.status} ${text.slice(0, 1000)}`);
  return j.data;
}

let browser;
try {
  const csrf = (await api("GET", "/api/session")).csrfToken;
  await api("POST", "/api/workspace/open", { path: PROJECT }, csrf);
  const config = { inputMode: "filelist", filelistPath: "design.f", topMode: "explicit", topModule: "TOP", defines: [{name:"VERILATOR"}], includeRoots: [], libraries: [], parameters: [], language: "1800-2017", singleUnit: true, threads: 4, warningAsError: false, warningOptions: [] };
  const project = (await api("POST", "/api/projects", { config }, csrf)).project;
  const pid = project.projectId;
  const job = await api("POST", `/api/projects/${pid}/build`, { configRevision: 1, requestKey: `wave-${Date.now()}` }, csrf);
  let final;
  for (let i=0;i<1800;i++) {
    final = await api("GET", `/api/projects/${pid}/jobs/${job.jobId}`);
    if (["COMPLETE","FAILED","CANCELLED"].includes(final.state)) break;
    await sleep(100);
  }
  if (final.state !== "COMPLETE") console.log(await api("GET", `/api/projects/${pid}/jobs/${job.jobId}/diagnostics`));
  assert.equal(final.state,"COMPLETE");
  const sid = (await api("GET", `/api/projects/${pid}/snapshots`))[0].snapshotId;
  const prefix = `/api/projects/${pid}/snapshots/${sid}`;
  const target = await api("GET", prefix+"/wave-source?scope=TOP.TestTop.l3&name=clock");
  assert.ok(target.sourceId);
  const aliasSource=await api("GET",prefix+"/wave-source?scope=TOP.TestTop.l2_nodes.slices_0&name=_mainPipe_io_toDS_req_s3_bits_way");
  const aliasTargets=await api("GET",prefix+`/wave-targets?instanceId=${aliasSource.instanceId}&symbolId=${aliasSource.symbolId}`);
  assert.ok(aliasTargets.paths.includes("TOP.TestTop.l2_nodes.slices_0.dataStorage.io_req_bits_way"));
  assert.ok(aliasTargets.paths.every(p=>p.startsWith("TOP.TestTop.l2_nodes.slices_0.")),"never use same-name sibling instance");
  const wave = path.join(PROJECT,"wave","llc-256k.fst");
  const meta = await api("POST","/api/waveform",{op:"signals",path:wave,query:"TOP.TestTop.l3.clock",offset:0},csrf);
  assert.equal(meta.total,1);
  const busTarget = await api("GET", prefix+"/wave-source?scope=TOP.TestTop.l3&name=io_rn_0_tx_req_flit");
  assert.equal(busTarget.instanceId, target.instanceId);
  await assert.rejects(api("GET", prefix+"/wave-source?scope=TOP.WRONG.l3&name=clock"), /不存在/);
  await assert.rejects(api("POST","/api/waveform",{op:"values",path:wave,handles:[1],start:"-1",end:"10"},csrf), /timestamp/);
  await assert.rejects(api("POST","/api/waveform",{op:"signals",path:wave,query:"",offset:0},"invalid"));
  const openRequest = {op:"open", projectId:pid, snapshotId:sid};
  const validated = await api("POST","/api/waveform",{...openRequest,path:wave},csrf);
  assert.ok(validated.roots.some(r=>r.name==="TOP"));
  for (const [name,pattern] of [["wrong-top",/RTL 顶层为 TOP.*FST 顶层为 OtherTop/],["wrong-module",/OtherModule/],["empty",/没有有效|读取失败/],["corrupt",/读取失败/]]) {
    await assert.rejects(api("POST","/api/waveform",{...openRequest,path:path.join(fixtures,name+".fst")},csrf),pattern);
  }
  const multiRoots = await api("POST","/api/waveform",{...openRequest,path:path.join(fixtures,"multiple-roots.fst")},csrf);
  assert.equal(multiRoots.roots.length,2);
  await assert.rejects(api("POST","/api/waveform",{op:"open",path:wave},csrf),/先加载 RTL/);
  console.log("OpenLLC build, source mapping and request validation PASS", target);
  browser = await chromium.launch({headless:true, executablePath: process.env.RTL_CHROMIUM || path.join(ROOT,".sandbox/deps/browser/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell"), args:["--no-sandbox"]});
  const context = await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addCookies([{name:cookie.split("=")[0],value:cookie.slice(cookie.indexOf("=")+1),url:base}]);
  const page = await context.newPage();
  let waveformRequests=0; page.on("request",r=>{if(new URL(r.url()).pathname==="/api/waveform") waveformRequests++;});
  const errors=[]; page.on("pageerror",e=>errors.push(e.message));
  await page.goto(`${base}/?project=${pid}&snapshot=${sid}&instance=${target.instanceId}&source=${target.sourceId}&line=${target.line}`,{waitUntil:"networkidle"});
  async function checkSearch(scope, label) {
    await page.locator(scope).click({position:{x:5,y:5}});
    await page.keyboard.press("Control+f");
    assert.equal(await page.getByRole("textbox",{name:label,exact:true}).evaluate(el=>el===document.activeElement),true, `${scope} Ctrl+F`);
  }
  await checkSearch(".left-pane", "搜索层次…");
  await checkSearch(".source-pane", "搜索源码…");
  await checkSearch(".inspector-panel", "搜索端口/参数…");
  await page.getByRole("button",{name:"Compile",exact:true}).click();
  await checkSearch(".compile-panel", "搜索诊断…");
  await page.getByRole("button",{name:"Waveform",exact:true}).click();
  assert.equal(waveformRequests,0,"project must not automatically open waveforms");
  assert.equal(await page.locator(".wave-canvas").count(),0);
  assert.ok(await page.getByText("当前未加载波形。请手动打开与 RTL 顶层匹配的 FST 文件。",{exact:true}).isVisible());
  await page.getByRole("textbox",{name:"FST 文件路径"}).fill(path.join(fixtures,"wrong-top.fst"));
  await page.getByRole("button",{name:"打开 FST",exact:true}).click();
  await page.getByRole("alert").filter({hasText:"波形与源码顶层不匹配"}).waitFor();
  assert.equal(await page.getByRole("textbox",{name:"搜索波形信号"}).count(),0);
  await page.getByRole("textbox",{name:"FST 文件路径"}).fill(wave);
  await page.getByRole("button",{name:"打开 FST",exact:true}).click();
  await page.getByRole("textbox",{name:"搜索波形信号"}).waitFor();
  assert.match(await page.locator('.wave-markers').innerText(),/主游标=50.*副游标=50.*Δ\(副−主\)=0/);
  await checkSearch(".wave-panel", "搜索波形信号");
  await page.getByRole("textbox",{name:"搜索波形信号"}).fill("TOP.TestTop.l3.clock");
  await page.getByRole("button",{name:"TOP.TestTop.l3.clock [1] +",exact:true}).click();
  await page.locator(".wave-canvas").waitFor();
  await page.waitForFunction(()=>document.querySelector(".wave-label small")?.textContent!=="—");
  await page.locator(".wave-canvas").dblclick();
  await page.waitForFunction(()=>new URL(location.href).searchParams.has("ts"));
  assert.equal(new URL(page.url()).searchParams.get("source"), target.sourceId);
  const signal = page.locator(".src-code .sem").filter({hasText:/^clock$/}).first();
  await page.getByRole("button",{name:"移除 TOP.TestTop.l3.clock",exact:true}).click();
  await signal.focus(); await signal.press("Control+w");
  await page.locator(".wave-canvas").waitFor();
  await page.waitForFunction(()=>document.querySelector(".wave-label small")?.textContent!=="—");
  await page.getByRole("button",{name:"Trace",exact:true}).click();
  await page.getByRole("button",{name:"Waveform",exact:true}).click();
  assert.equal(await page.locator(".wave-canvas").count(),1);
  await signal.click({button:"right"});
  await page.getByRole("button",{name:"Load — 追目的端",exact:true}).click();
  await page.waitForFunction(()=>document.querySelector(".panel-tabs button.active")?.textContent==="Trace");
  await checkSearch(".trace-panel", "搜索 Trace…");
  await page.getByRole("button",{name:"Waveform",exact:true}).click();
  await page.getByRole("button",{name:"放大",exact:true}).click();
  await page.waitForFunction(()=>document.querySelector(".wave-label small")?.textContent!=="—");
  await page.getByRole("textbox",{name:"搜索波形信号"}).fill("TOP.TestTop.l3.io_rn_0_tx_req_flit");
  await page.getByRole("button",{name:"TOP.TestTop.l3.io_rn_0_tx_req_flit [161:0] [162] +",exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll(".wave-canvas").length===2 && [...document.querySelectorAll(".wave-label small")].every(el=>el.textContent!=="—"));
  await page.locator(".wave-canvas").nth(1).dblclick();
  await page.waitForFunction(line=>new URL(location.href).searchParams.get("line")===String(line),busTarget.line);
  assert.ok(await page.locator(".src-code .sem-hl").filter({hasText:/^io_rn_0_tx_req_flit$/}).count());
  await page.getByRole("button",{name:"移除 TOP.TestTop.l3.io_rn_0_tx_req_flit [161:0]",exact:true}).click();
  const busToken = page.locator(".src-code .sem-hl").filter({hasText:/^io_rn_0_tx_req_flit$/}).first();
  await busToken.focus(); await busToken.press("Control+w");
  await page.waitForFunction(()=>document.querySelectorAll(".wave-canvas").length===2 && [...document.querySelectorAll(".wave-label small")].every(el=>el.textContent!=="—"));
  await (await import("./waveform-advanced-ui.mjs")).checkAdvancedWaveforms(page,wave);
  await page.goto(`${base}/?project=${pid}&snapshot=${sid}&instance=${aliasSource.instanceId}&source=${aliasSource.sourceId}&line=3858`,{waitUntil:'networkidle'});
  await page.getByRole('button',{name:'Waveform',exact:true}).click();
  await page.getByRole('textbox',{name:'FST 文件路径'}).fill(wave);
  await page.getByRole('button',{name:'打开 FST',exact:true}).click();
  await page.getByRole('textbox',{name:'搜索波形信号'}).waitFor();
  const aliasToken=page.locator('.src-code .sem').filter({hasText:/^_mainPipe_io_toDS_req_s3_bits_way$/}).last();
  await aliasToken.focus();await aliasToken.press('Control+w');
  await page.locator('.wave-label[title="TOP.TestTop.l2_nodes.slices_0.dataStorage.io_req_bits_way [1:0]"]').waitFor();
  console.log('Slice.sv instance connection: optimized wire resolves to exact full-width child port: PASS');
  fs.mkdirSync(path.join(ROOT,".sandbox/evidence"),{recursive:true});
  await page.screenshot({path:path.join(ROOT,".sandbox/evidence/openllc-waveform.png")});
  // A failed replacement must not leave the previous trace on screen.
  await page.getByRole("textbox",{name:"FST 文件路径"}).fill(path.join(fixtures,"wrong-module.fst"));
  await page.getByRole("button",{name:"打开 FST",exact:true}).click();
  await page.getByRole("alert").filter({hasText:"OtherModule"}).waitFor();
  assert.equal(await page.locator(".wave-canvas").count(),0);
  assert.equal(await page.getByRole("textbox",{name:"搜索波形信号"}).count(),0);
  await page.getByRole("textbox",{name:"FST 文件路径"}).fill(path.join(fixtures,"corrupt.fst"));
  await page.getByRole("button",{name:"打开 FST",exact:true}).click();
  await page.getByRole("alert").filter({hasText:"读取失败"}).waitFor();
  await page.getByRole("textbox",{name:"FST 文件路径"}).fill(wave);
  await page.getByRole("button",{name:"打开 FST",exact:true}).click();
  await page.getByRole("textbox",{name:"搜索波形信号"}).waitFor();
  assert.equal(await page.getByRole("alert").count(),0,"valid file clears previous failure");
  // Start from the UI and stay on Compile: initial empty diagnostics must refresh
  // when warnings arrive and again on completion, without switching tabs/reload.
  await page.getByRole('button',{name:'编译并建立索引',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.compile-panel .compile-summary')?.textContent.includes('COMPLETE'),{},{timeout:180000});
  await page.locator('.compile-panel .diag-warning').first().waitFor();
  const warningSummary=await page.locator('.compile-summary').innerText();
  assert.match(warningSummary,/warning [1-9]\d*/);
  const firstPageCount=await page.locator('.compile-panel .diag').count();
  assert.equal(firstPageCount,200);
  await page.getByRole('button',{name:'加载更多诊断',exact:true}).click();
  await page.waitForFunction(n=>document.querySelectorAll('.compile-panel .diag').length>n,firstPageCount);
  console.log('OpenLLC live compilation warnings refresh without tab switching; pagination: PASS');
  assert.deepEqual(errors,[]);
  console.log("OpenLLC FST display, double-click source navigation, Ctrl+W, six Ctrl+F search scopes, bus values, top validation, manual loading and failure recovery: PASS");
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
