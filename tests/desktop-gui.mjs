// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { _electron as electron } from 'playwright-core';
if (process.env.CI !== 'true' || process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('GUI tests run only on independent macOS ARM64 CI');
const appPath = process.env.RTL_DESKTOP_APP;
assert(appPath, 'RTL_DESKTOP_APP must point to the relocated .app');
const executablePath = path.join(appPath, 'Contents/MacOS/RTL Browser');
const temp = fs.mkdtempSync(path.resolve('state/desktop-gui-'));
const project = path.join(temp, '中文 工程');
fs.mkdirSync(project);
fs.writeFileSync(path.join(project, 'top.sv'), 'module TOP(input logic clock, output logic result); assign result = clock; endmodule\n');
fs.writeFileSync(path.join(project, 'design.f'), 'top.sv\n');
const waves = path.join(temp, '外部 波形');
execFileSync(path.resolve('build/desktop-26/wave-worker/wave-fixtures'), [waves]);
const waveform = path.join(waves, 'multiple-roots.fst');
const env = { HOME: path.join(temp, 'home'), TMPDIR: path.join(temp, 'tmp'), PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8', CI: 'true', RTL_DESKTOP_TEST_DATA: path.join(temp, 'preferences') };
fs.mkdirSync(env.HOME); fs.mkdirSync(env.TMPDIR);
let app;
async function launch() {
  const instance = await electron.launch({ executablePath, cwd: temp, env, timeout: 30000 });
  const page = await instance.firstWindow();
  await page.waitForURL(/http:\/\/127\.0\.0\.1:/);
  await page.waitForFunction(() => !!window.rtlDesktop && document.querySelector('main'));
  return { instance, page };
}
async function api(page, method, route, body) {
  const response = await page.evaluate(async ({ method, route, body }) => {
    const session = await fetch('/api/session').then(r => r.json());
    return fetch(route, { method, headers: { 'content-type': 'application/json', 'x-rtl-csrf': session.data.csrfToken }, body: body === undefined ? undefined : JSON.stringify(body) }).then(r => r.json());
  }, { method, route, body });
  assert.equal(response.ok, true, JSON.stringify(response)); return response.data;
}
async function picker(instance, page, value, mode) {
  // Substitute the OS dialog result, exercising the real main/preload/IPC grant path.
  await instance.evaluate(({ dialog }, value) => { dialog.showOpenDialog = async () => ({ canceled: !value, filePaths: value ? [value] : [] }); }, value);
  return page.evaluate(mode => window.rtlDesktop.pick(mode), mode);
}
async function waitForJob(page, id, jobId) {
  for (let i = 0; i < 300; i++) {
    const job = await api(page, 'GET', `/api/projects/${id}/jobs/${jobId}`);
    if (['COMPLETE', 'FAILED', 'CANCELLED'].includes(job.state)) return job;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Build timeout');
}
try {
  let { instance, page } = await launch(); app = instance;
  assert.deepEqual(await page.evaluate(() => [typeof window.require, typeof window.process]), ['undefined', 'undefined']);
  const security = await app.evaluate(({ BrowserWindow }) => {
    const preferences = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return [preferences.nodeIntegration, preferences.contextIsolation, preferences.sandbox];
  });
  assert.deepEqual(security, [false, true, true]);
  assert.equal(await picker(app, page, null, 'directory'), null);
  assert.equal(await picker(app, page, project, 'directory'), project);
  await api(page, 'POST', '/api/workspace/open', { path: project });
  const created = await api(page, 'POST', '/api/projects', { config: {
    inputMode: 'filelist', filelistPath: 'design.f', topMode: 'explicit', topModule: 'TOP', defines: [], includeRoots: [], libraries: [], parameters: [], language: '1800-2017', singleUnit: false, threads: 1, warningAsError: false, warningOptions: [],
  } });
  const id = created.project.projectId;
  const build = await api(page, 'POST', `/api/projects/${id}/build`, { configRevision: 1, requestKey: crypto.randomUUID() });
  const job = await waitForJob(page, id, build.jobId); assert.equal(job.state, 'COMPLETE');
  // Query child must use the packaged Node with SQLite, with no repo or Node on PATH.
  const hierarchy = await api(page, 'GET', `/api/projects/${id}/snapshots/${job.snapshotId}/hierarchy/children`);
  assert.equal(hierarchy.records[0].path, 'TOP');
  assert.equal(await picker(app, page, waveform, 'file'), waveform);
  const wave = await api(page, 'POST', '/api/waveform', { op: 'open', path: waveform, projectId: id, snapshotId: job.snapshotId });
  assert(wave.signalCount > 0);
  const importedRoot = path.join(temp, '导入快照'); fs.mkdirSync(importedRoot);
  const roundtrip = await page.evaluate(async ({ id, snapshotId, importedRoot, project }) => {
    const session = (await fetch('/api/session').then(r => r.json())).data;
    const headers = { 'content-type': 'application/json', 'x-rtl-csrf': session.csrfToken };
    const bytes = await fetch(`/api/projects/${id}/snapshots/${snapshotId}/export`).then(r => r.arrayBuffer());
    const open = root => fetch('/api/workspace/open', { method: 'POST', headers, body: JSON.stringify({ path: root }) }).then(r => r.json());
    await open(importedRoot);
    const imported = await fetch('/api/workspace/snapshot/import', { method: 'POST', headers: { ...headers, 'content-type': 'application/octet-stream' }, body: bytes }).then(r => r.json());
    await open(project);
    return imported;
  }, { id, snapshotId: job.snapshotId, importedRoot, project });
  assert.equal(roundtrip.ok, true, JSON.stringify(roundtrip));
  assert.equal(roundtrip.data.snapshot.topModule, 'TOP');
  const key = 'rtl.wave.layout.v1:' + waveform;
  await page.evaluate(async ({ key }) => { await window.rtlDesktop.setLayout(key, '{"version":1}'); await window.rtlDesktop.setPreference('rtl.theme', 'dark'); }, { key });
  const downloads = path.join(temp, 'export.json');
  await app.evaluate(({ BrowserWindow }, file) => {
    BrowserWindow.getAllWindows()[0].webContents.session.once('will-download', (_event, item) => item.setSavePath(file));
  }, downloads);
  await page.evaluate(() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['{"version":1}'])); a.download = 'layout.json'; a.click(); });
  for (let i = 0; i < 100 && !fs.existsSync(downloads); i++) await new Promise(r => setTimeout(r, 100));
  assert.equal(fs.readFileSync(downloads, 'utf8'), '{"version":1}');
  const duplicate = spawn(executablePath, [], { env, cwd: temp, stdio: 'ignore' });
  const timeout = setTimeout(() => duplicate.kill('SIGKILL'), 15000);
  const [code] = await once(duplicate, 'exit'); clearTimeout(timeout); assert.equal(code, 0);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  const oldOrigin = new URL(page.url()).origin;
  await app.close(); app = null;
  ({ instance, page } = await launch()); app = instance;
  assert.notEqual(new URL(page.url()).origin, oldOrigin);
  const reopened = await api(page, 'POST', '/api/workspace/open', { path: project });
  assert.equal(reopened.project.currentSnapshotId, job.snapshotId);
  assert.equal(await page.evaluate(key => window.rtlDesktop.getLayout(key), key), '{"version":1}');
  assert.equal(await page.evaluate(async () => (await window.rtlDesktop.preferences())['rtl.theme']), 'dark');
  const newWindow = app.waitForEvent('window');
  await app.evaluate(({ BrowserWindow, app }) => { BrowserWindow.getAllWindows()[0].close(); setTimeout(() => app.emit('activate'), 100); });
  page = await newWindow; await page.waitForURL(/http:\/\/127\.0\.0\.1:/);
  await page.waitForFunction(() => !!window.rtlDesktop);
  // A backend crash displays retry and recovers the persisted project state.
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0 }); });
  const lock = JSON.parse(fs.readFileSync(path.join(project, '.rtlb/desktop/lock.json')));
  const beforeCrash = new URL(page.url()).origin;
  process.kill(lock.pid, 'SIGKILL');
  await page.waitForURL(url => url.origin !== beforeCrash && url.hostname === '127.0.0.1', { timeout: 30000 });
  const recovered = await api(page, 'POST', '/api/workspace/open', { path: project });
  assert.equal(recovered.project.currentSnapshotId, job.snapshotId);
  // Quit during native compilation must release project lock and the process group.
  await api(page, 'POST', `/api/projects/${id}/build`, { configRevision: 1, requestKey: crypto.randomUUID() });
  const lastPid = JSON.parse(fs.readFileSync(path.join(project, '.rtlb/desktop/lock.json'))).pid;
  await app.close(); app = null;
  assert(!fs.existsSync(path.join(project, '.rtlb/desktop/lock.json')));
  assert.throws(() => process.kill(lastPid, 0));
  console.log('Relocated desktop: sandboxed renderer, native pickers/cancel, offline build/query/FST, export, restart, Dock, duplicate launch, crash and quit: PASS');
} finally {
  if (app) await app.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
