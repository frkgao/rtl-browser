// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { ProjectStore } from '../dist/server/packages/core/src/projectStore.js';
import { AllowedRoots } from '../dist/server/packages/core/src/paths.js';
const temp = fs.mkdtempSync(path.resolve('state/desktop-'));
const project = path.join(temp, '中文工程 with spaces');
fs.cpSync('tests/fixtures/simple', project, { recursive: true });
const layoutKey = 'rtl.wave.layout.v1:/selected/wave.fst';
const config = { inputMode: 'filelist', filelistPath: 'design.f', topMode: 'explicit', topModule: 'top', defines: [], includeRoots: [], libraries: [], parameters: [], language: '1800-2017', singleUnit: false, threads: 1, warningAsError: false, warningOptions: [] };
const processes = new Set();
const runtime = process.env.RTL_DESKTOP_RUNTIME;

async function start() {
  const child = fork(path.resolve(runtime || '.', 'dist/server/apps/server/src/main.js'), ['--workspace', temp,
    ...(runtime ? ['--worker', path.join(runtime, 'bin/index-worker')] : [])], {
    execPath: runtime ? path.join(runtime, 'bin/node') : process.execPath,
    cwd: temp, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: runtime ? { HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, PATH: '/usr/bin:/bin', RTL_DESKTOP: '1', RTL_WAVE_WORKER: path.join(runtime, 'bin/wave-worker') } : { ...process.env, RTL_DESKTOP: '1' },
  });
  processes.add(child);
  let log = '';
  child.stdout.on('data', c => { log += c; });
  child.stderr.resume();
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('startup timeout')), 15000);
    child.once('error', reject);
    child.once('exit', () => { clearTimeout(timer); reject(new Error('backend exited')); });
    child.on('message', m => { if (m.type === 'ready') { clearTimeout(timer); resolve(m.url); } });
  });
  assert(!log.includes('token='), 'desktop must not log bootstrap tokens');
  const origin = new URL(url).origin;
  const bootstrap = await fetch(url, { redirect: 'manual' });
  const cookie = bootstrap.headers.get('set-cookie').split(';')[0];
  const session = await fetch(origin + '/api/session', { headers: { cookie } }).then(r => r.json());
  return {
    child, origin,
    async api(method, route, body) {
      const result = await fetch(origin + route, { method, headers: { cookie, origin, 'x-rtl-csrf': session.data.csrfToken, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).then(r => r.json());
      assert.equal(result.ok, true, JSON.stringify(result)); return result.data;
    },
    ipc(type, data = {}) {
      return new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        const timer = setTimeout(() => { child.off('message', listener); reject(new Error('IPC timeout')); }, 10000);
        const listener = m => { if (m.id === id) { clearTimeout(timer); child.off('message', listener); m.error ? reject(new Error(m.error)) : resolve(m.value); } };
        child.on('message', listener); child.send({ id, type, ...data });
      });
    },
    async stop(signal) { const exited = once(child, 'exit'); signal ? child.kill(signal) : child.send({ type: 'shutdown' }); await exited; processes.delete(child); },
  };
}
try {
  let server = await start();
  await server.api('POST', '/api/workspace/open', { path: project });
  const created = await server.api('POST', '/api/projects', { config });
  const id = created.project.projectId;
  const job = await server.api('POST', `/api/projects/${id}/build`, { configRevision: 1, requestKey: crypto.randomUUID() });
  let completed;
  for (let i = 0; i < 300; i++) {
    completed = await server.api('GET', `/api/projects/${id}/jobs/${job.jobId}`);
    if (['COMPLETE', 'FAILED', 'CANCELLED'].includes(completed.state)) break;
    await new Promise(r => setTimeout(r, 100));
  }
  assert.equal(completed.state, 'COMPLETE');
  const hierarchy = await server.api('GET', `/api/projects/${id}/snapshots/${completed.snapshotId}/hierarchy/children`);
  assert.equal(hierarchy.records[0].path, 'top');
  await server.ipc('layout-set', { key: layoutKey, value: '{"version":1}' });
  await assert.rejects(server.ipc('layout-set', { key: '../../escape', value: '{}' }));
  const conflict = new ProjectStore('conflict', true);
  await assert.rejects(conflict.openRoot(project), /另一个桌面实例/);
  const firstOrigin = server.origin;
  await server.stop();
  const dir = path.join(project, '.rtlb/desktop');
  assert(fs.existsSync(path.join(dir, 'project.json')));
  assert(!fs.existsSync(path.join(dir, 'lock.json')));
  server = await start();
  assert.notEqual(server.origin, firstOrigin, 'restart uses random port');
  const reopened = await server.api('POST', '/api/workspace/open', { path: project });
  assert.equal(reopened.project.projectId, id);
  assert.equal(reopened.project.currentSnapshotId, completed.snapshotId);
  assert.equal(await server.ipc('layout-get', { key: layoutKey }), '{"version":1}');
  await server.stop('SIGKILL');
  assert(fs.existsSync(path.join(dir, 'lock.json')), 'crash leaves recoverable lock');
  const recovered = new ProjectStore('recovered', true);
  await recovered.openRoot(project);
  recovered.setActiveJob(id, 'interrupted');
  await recovered.writeJob({ ...completed, jobId: 'interrupted', projectId: id, state: 'RUNNING', finishedAt: null });
  recovered.closeAll();
  const recovery = new ProjectStore('recovery', true);
  await recovery.openRoot(project);
  assert.equal(recovery.get(id).activeJobId, null);
  assert.equal(recovery.readJob(id, 'interrupted').stage, 'INTERRUPTED');
  recovery.purgeSessionState(); recovery.closeAll();
  const web = new ProjectStore('web');
  const opened = await web.openRoot(project);
  assert.equal(opened.project, null, 'Web does not reuse desktop state');
  web.purgeSessionState(); web.closeAll();
  assert(fs.existsSync(path.join(dir, 'project.json')), 'Web purge preserves desktop');
  fs.writeFileSync(path.join(dir, 'project.json'), '{broken');
  await assert.rejects(new ProjectStore('corrupt', true).openRoot(project), /原始状态已保留/);
  assert.equal(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'), '{broken');
  assert(!fs.existsSync(path.join(dir, 'lock.json')));
  const readonly = path.join(temp, 'readonly'); fs.mkdirSync(readonly); fs.chmodSync(readonly, 0o500);
  try { if (process.getuid?.() !== 0) await assert.rejects(new ProjectStore('readonly', true).openRoot(readonly)); } finally { fs.chmodSync(readonly, 0o700); }
  const root = path.join(temp, 'allowed'); fs.mkdirSync(root);
  const file = path.join(temp, 'one.fst'); fs.writeFileSync(file, '');
  const sibling = path.join(temp, 'two.fst'); fs.writeFileSync(sibling, '');
  const roots = new AllowedRoots([root]); roots.addFile(file);
  assert.equal(roots.resolve(file), file); assert.throws(() => roots.resolve(sibling));
  console.log('Desktop persistence, native build, restart, crash recovery, lock, read-only, IPC and Web isolation: PASS');
} finally {
  for (const child of processes) { const exit = once(child, 'exit'); child.kill('SIGKILL'); await exit; }
  fs.rmSync(temp, { recursive: true, force: true });
}
