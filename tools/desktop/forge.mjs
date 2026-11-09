// SPDX-License-Identifier: Apache-2.0
import { spawnSync } from 'node:child_process';
if (process.env.CI !== 'true' || process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('Desktop GUI and packaging are restricted to independent macOS ARM64 CI. Local builds use desktop:build only.');
}
const command = process.argv[2];
if (!['package', 'make'].includes(command)) throw new Error('Invalid Forge command');
const result = spawnSync(process.execPath, ['node_modules/@electron-forge/cli/dist/electron-forge.js', command, '--platform=darwin', '--arch=arm64'], { stdio: 'inherit', env: { ...process.env, ELECTRON_CACHE: process.cwd() + '/.sandbox/cache/electron' } });
process.exit(result.status ?? 1);
