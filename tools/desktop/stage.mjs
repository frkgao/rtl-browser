// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root = process.cwd();
const developer = process.env.DEVELOPER_DIR || execFileSync('/usr/bin/xcode-select', ['-p'], { encoding: 'utf8' }).trim();
function appleTool(name) {
  for (const dir of ['Toolchains/XcodeDefault.xctoolchain/usr/bin', 'usr/bin']) {
    const file = path.join(developer, dir, name);
    if (fs.existsSync(file)) return file;
  }
  throw new Error('Apple tool missing: ' + name);
}
const out = path.resolve('dist/desktop/runtime');
const versions = JSON.parse(fs.readFileSync('tools/deps/versions.json'));
const pkg = JSON.parse(fs.readFileSync('package.json'));
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
function copy(source, dest) {
  fs.mkdirSync(path.dirname(path.join(out, dest)), { recursive: true });
  fs.cpSync(source, path.join(out, dest), { recursive: true, dereference: true });
}
// Explicit resource allowlist: no repository, examples, waveform, cache or user data.
for (const name of ['apps/server', 'packages/contracts', 'packages/core', 'packages/storage'])
  copy('dist/server/' + name, 'dist/server/' + name);
copy('dist/web', 'dist/web');
copy('contracts/sql/schema.sql', 'contracts/sql/schema.sql');
copy(`.sandbox/deps/node-v${versions.nodeVersion}-darwin-arm64/bin/node`, 'bin/node');
for (const name of ['index-worker', 'wave-worker']) copy(`build/desktop-26/${name}/${name}`, `bin/${name}`);
for (const name of ['LICENSE', 'NOTICE']) copy(name, name);
copy('third_party/licenses', 'licenses');
for (const name of ['libfst', 'zlib']) {
  for (const file of fs.readdirSync('third_party/' + name))
    if (/license|copying|notice/i.test(file)) copy(`third_party/${name}/${file}`, `licenses/${name}-${file}`);
}
// Preserve source-embedded license notices for vendored compressors as well.
for (const name of ['libfst/fastlz.c', 'libfst/lz4.c', 'libfst/fstapi.c', 'zlib/zlib.h']) {
  const text = fs.readFileSync('third_party/' + name, 'utf8');
  fs.writeFileSync(path.join(out, 'licenses', path.basename(name) + '-notice.txt'), text.slice(0, text.indexOf('*/') + 2) + '\n');
}
fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version, type: 'module', license: pkg.license }));
fs.writeFileSync(path.join(out, 'runtime-versions.json'), JSON.stringify({ node: versions.nodeVersion, electron: pkg.devDependencies.electron, slang: versions.slangCommit, minimumMacOS: '26.0', arch: 'arm64' }, null, 2));
for (const name of ['node', 'index-worker', 'wave-worker']) {
  const file = path.join(out, 'bin', name);
  fs.chmodSync(file, 0o755);
  assert.match(execFileSync(appleTool('lipo'), ['-archs', file], { encoding: 'utf8' }), /arm64/);
  const load = execFileSync(appleTool('otool'), ['-l', file], { encoding: 'utf8' });
  const min = [...load.matchAll(/cmd LC_(?:BUILD_VERSION|VERSION_MIN_MACOSX)\n[\s\S]*?(?:minos|version) (\d+)\.(\d+)/g)].map(m => Number(m[1]));
  assert(min.length && Math.max(...min) <= 26, name + ' requires a newer macOS');
  const libs = execFileSync(appleTool('otool'), ['-L', file], { encoding: 'utf8' }).split('\n').slice(1).filter(Boolean);
  assert(libs.every(line => /^\s+\/(usr\/lib|System\/Library)\//.test(line)), name + ' has non-system dynamic dependencies');
  if (name !== 'node') execFileSync(appleTool('strip'), ['-x', file]);
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', file]);
}
function audit(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) audit(file);
    else {
      assert(!/\.(fst|tar|map)$/.test(entry.name), 'Unexpected private/build artifact');
      const bytes = fs.readFileSync(file);
      for (const forbidden of [root, process.env.HOME].filter(p => p && p.length > 5))
        assert(!bytes.includes(Buffer.from(forbidden)), 'Build-machine path embedded in ' + path.relative(out, file));
    }
  }
}
audit(out);
console.log('Desktop runtime staged: ARM64, macOS <= 26, system-only dylibs, privacy allowlist PASS');
