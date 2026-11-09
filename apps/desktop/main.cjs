// SPDX-License-Identifier: Apache-2.0
const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const { fork } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

app.setName('RTL Browser');
app.setPath('userData', path.join(app.getPath('appData'), 'RTL Browser'));

// Only CI may override userData; development GUI execution is deliberately a separate task.
if (process.env.RTL_DESKTOP_TEST_DATA && process.env.CI === 'true') app.setPath('userData', path.resolve(process.env.RTL_DESKTOP_TEST_DATA));
const runtime = app.isPackaged ? path.join(process.resourcesPath, 'runtime') : path.resolve(__dirname, '../../dist/desktop/runtime');
let window, backend, origin, readyUrl, quitting = false, starting, stopping, errorDialog = false;
let prefs = {}, bounds = {}, recent = [];
const pending = new Map();
let pendingProject = null, rendererReady = false;
const prefsFile = () => path.join(app.getPath('userData'), 'preferences.json');
function persist() {
  const file = prefsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file + '.tmp', JSON.stringify({ prefs, bounds, recent }), { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
}
function validSender(event) {
  return window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && new URL(event.senderFrame.url).origin === origin;
}
function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!validSender(event)) throw new Error('Untrusted desktop request');
    return fn(...args);
  });
}
function request(type, data = {}) {
  return new Promise((resolve, reject) => {
    if (!backend?.connected) return reject(new Error('后台服务不可用，请重启服务'));
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('后台请求超时')); }, 10000);
    pending.set(id, { resolve, reject, timer });
    backend.send({ id, type, ...data });
  });
}
function killGroup(child) {
  if (child?.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ } }
}
async function stopBackend() {
  if (stopping) return stopping;
  const child = backend;
  if (!child) return;
  stopping = new Promise(resolve => {
    let done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(timer); killGroup(child); resolve(); };
    const timer = setTimeout(finish, 6000);
    child.once('exit', finish);
    if (child.connected) child.send({ type: 'shutdown' }); else finish();
  });
  await stopping;
  if (backend === child) backend = null;
  stopping = null;
}
async function reportFailure() {
  if (quitting || errorDialog) return;
  errorDialog = true;
  const { response } = await dialog.showMessageBox({ type: 'error', title: 'RTL Browser', message: '后台服务未能启动或意外退出。', detail: '可以重试；工程配置和已完成的索引会保留。若重复失败，请重新安装完整的应用包。', buttons: ['重试', '退出'], defaultId: 0 });
  errorDialog = false;
  if (response === 0) { await stopBackend(); await start().catch(reportFailure); } else app.quit();
}
async function start() {
  if (starting) return starting;
  starting = (async () => {
    const workspace = path.join(app.getPath('userData'), 'empty-workspace');
    fs.mkdirSync(workspace, { recursive: true, mode: 0o700 });
    readyUrl = null;
    const child = fork(path.join(runtime, 'dist/server/apps/server/src/main.js'), [
      '--workspace', workspace, '--web', path.join(runtime, 'dist/web'),
      '--worker', path.join(runtime, 'bin/index-worker'), '--schema', path.join(runtime, 'contracts/sql/schema.sql'),
    ], {
      execPath: path.join(runtime, 'bin/node'), cwd: workspace, detached: true,
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      // Do not inherit NODE_OPTIONS, DYLD_*, compiler paths or repository overrides.
      env: { HOME: app.getPath('home'), TMPDIR: app.getPath('temp'), PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8',
        RTL_DESKTOP: '1', RTL_WAVE_WORKER: path.join(runtime, 'bin/wave-worker') },
    });
    backend = child;
    child.stderr.resume();
    child.on('message', message => {
      const p = pending.get(message?.id);
      if (p) { clearTimeout(p.timer); pending.delete(message.id); message.error ? p.reject(new Error(message.error)) : p.resolve(message.value); }
    });
    child.once('exit', () => {
      killGroup(child);
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('后台服务已退出')); }
      pending.clear();
      if (backend === child) { backend = null; readyUrl = null; }
      if (!quitting && !stopping) void reportFailure();
    });
    readyUrl = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { killGroup(child); reject(new Error('startup timeout')); }, 20000);
      child.once('error', err => { clearTimeout(timer); reject(err); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('backend exit')); });
      child.on('message', message => {
        if (message?.type === 'ready' && typeof message.url === 'string' && /^http:\/\/127\.0\.0\.1:\d+\/\?token=/.test(message.url)) {
          clearTimeout(timer); resolve(message.url);
        }
      });
    });
    origin = new URL(readyUrl).origin;
    if (!window) createWindow();
    await window.loadURL(readyUrl);
    window.show();
  })();
  try { await starting; } finally { starting = null; }
}
function createWindow() {
  window = new BrowserWindow({ width: bounds.width || 1440, height: bounds.height || 940, minWidth: 900, minHeight: 600, show: false,
    title: 'RTL Browser', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, spellcheck: false } });
  rendererReady = false;
  window.webContents.on('did-start-navigation', (_event, _url, inPlace, isMainFrame) => { if (isMainFrame && !inPlace) rendererReady = false; });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (e, url) => { if (new URL(url).origin !== origin) e.preventDefault(); });
  window.webContents.on('will-redirect', (e, url) => { if (new URL(url).origin !== origin) e.preventDefault(); });
  window.webContents.on('will-attach-webview', e => e.preventDefault());
  window.webContents.on('render-process-gone', () => { if (!quitting) void reportFailure(); });
  const session = window.webContents.session;
  session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !(details.url.startsWith(origin + '/') || details.url.startsWith('blob:' + origin + '/')) });
  });
  session.removeAllListeners('will-download');
  session.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({ title: '导出文件', defaultPath: path.join(app.getPath('documents'), path.basename(item.getFilename())) });
    item.once('done', (_e, state) => { if (state === 'interrupted') dialog.showErrorBox('导出失败', '请检查目标目录是否可写。'); });
  });
  window.on('close', () => { bounds = window.getNormalBounds(); persist(); });
  window.on('closed', () => { window = null; });
}
let choosing = null;
handle('desktop:pick', mode => {
  if (!['file', 'directory'].includes(mode)) throw new Error('Invalid picker mode');
  if (choosing) return choosing;
  choosing = (async () => {
    const result = await dialog.showOpenDialog(window, { properties: [mode === 'directory' ? 'openDirectory' : 'openFile'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const selected = result.filePaths[0];
    await request('grant', { path: selected });
    return selected;
  })().finally(() => { choosing = null; });
  return choosing;
});
const preferenceKeys = new Set(['rtl.theme', 'rtl.highContrast', 'rtl.globalScale', 'rtl.codeScale', 'rtl.leftWidth', 'rtl.rightWidth']);
handle('desktop:prefs', () => prefs);
handle('desktop:pref', (key, value) => {
  if (!preferenceKeys.has(key) || typeof value !== 'string' || value.length > 100) throw new Error('Invalid preference');
  prefs[key] = value; persist();
});
handle('desktop:layout-get', key => request('layout-get', { key }));
handle('desktop:layout-set', (key, value) => request('layout-set', { key, value }));
handle('desktop:subscribe', () => {
  rendererReady = true;
  if (pendingProject) { window.webContents.send('desktop:open-project', pendingProject); pendingProject = null; }
});
handle('desktop:recent', root => {
  if (typeof root !== 'string' || root.length > 4096 || !path.isAbsolute(root)) throw new Error('Invalid project');
  recent = [root, ...recent.filter(p => p !== root)].slice(0, 10); persist(); setMenu();
});
function setMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'RTL Browser', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
    { label: '文件', submenu: [{ label: '显示窗口', click: () => void showWindow() },
      { label: '最近工程', submenu: recent.length ? recent.map(root => ({ label: root, click: async () => { pendingProject = root; await showWindow(); if (rendererReady && window && pendingProject) { window.webContents.send('desktop:open-project', pendingProject); pendingProject = null; } } })) : [{ label: '无最近工程', enabled: false }] },
      { label: '重启后台服务', click: async () => { await stopBackend(); void start().catch(reportFailure); } }, { role: 'close' }] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'togglefullscreen' }] },
  ]));
}
async function showWindow() {
  await app.whenReady();
  if (starting) { await starting.catch(reportFailure); return; }
  if (!backend) return start().catch(reportFailure);
  if (!window) { createWindow(); await window.loadURL(origin); }
  if (window.isMinimized()) window.restore();
  window.show(); window.focus();
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { void showWindow(); });
  app.on('activate', () => { void showWindow(); });
  app.on('window-all-closed', () => { /* Dock reopens the single window. */ });
  let exitAllowed = false;
  app.on('before-quit', event => {
    if (exitAllowed) return;
    event.preventDefault(); quitting = true;
    void stopBackend().finally(() => { exitAllowed = true; app.quit(); });
  });
  app.whenReady().then(async () => {
    try {
      const saved = JSON.parse(fs.readFileSync(prefsFile(), 'utf8'));
      prefs = Object.fromEntries(Object.entries(saved.prefs || {}).filter(([key, value]) => preferenceKeys.has(key) && typeof value === 'string' && value.length <= 100));
      const size = saved.bounds || {};
      bounds = { width: Number.isInteger(size.width) ? Math.max(900, Math.min(4000, size.width)) : 1440,
        height: Number.isInteger(size.height) ? Math.max(600, Math.min(3000, size.height)) : 940 };
      recent = Array.isArray(saved.recent) ? saved.recent.filter(p => typeof p === 'string' && path.isAbsolute(p)).slice(0, 10) : [];
    } catch { /* first launch or damaged preferences: project state is untouched */ }
    setMenu(); await start();
  }).catch(reportFailure);
}
