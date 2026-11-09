// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { listPackage } from '@electron/asar';
const app = process.argv[2];
assert(app?.endsWith('.app'), 'Pass the packaged .app');
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
const plist = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(app, 'Contents/Info.plist')], { encoding: 'utf8' }));
assert.equal(plist.LSMinimumSystemVersion, '26.0');
assert.equal(plist.CFBundleIdentifier, 'org.rtl-browser.desktop');
const resources = path.join(app, 'Contents/Resources');
const allowed = new Set(['/package.json', '/apps', '/apps/desktop', '/apps/desktop/main.cjs', '/apps/desktop/preload.cjs']);
for (const file of listPackage(path.join(resources, 'app.asar'))) assert(allowed.has(file.replaceAll('\\', '/')), 'Unexpected app.asar entry: ' + file);
const runtime = path.join(resources, 'runtime');
assert.deepEqual(fs.readdirSync(runtime).sort(), ['LICENSE', 'NOTICE', 'bin', 'contracts', 'dist', 'licenses', 'package.json', 'runtime-versions.json'].sort());
assert.deepEqual(fs.readdirSync(path.join(runtime, 'bin')).sort(), ['index-worker', 'node', 'wave-worker']);
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue; // Electron framework links stay inside its signed bundle.
    if (entry.isDirectory()) { assert(!['.git', '.sandbox', '.rtlb', 'examples', 'state'].includes(entry.name)); walk(file); }
    else {
      assert(!/\.(fst|tar|map|log)$/.test(entry.name), 'Unwanted packaged artifact: ' + entry.name);
      const data = fs.readFileSync(file);
      for (const forbidden of [process.cwd(), process.env.HOME, process.env.GITHUB_WORKSPACE].filter(p => p && p.length > 5))
        assert(!data.includes(Buffer.from(forbidden)), 'Build-machine path in package');
    }
  }
}
walk(resources);
// Executed with only system commands on PATH, from outside the checkout.
assert.match(execFileSync(path.join(runtime, 'bin/node'), ['--version'], { cwd: path.dirname(app), env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8' }), /^v24\./);
console.log('Packaged app: signature, minimum OS, allowlist, licenses and private-path audit PASS');
