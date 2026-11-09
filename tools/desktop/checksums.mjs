// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const dir = 'dist/desktop/artifacts';
const artifacts = fs.readdirSync(dir).filter(name => /\.(dmg|zip)$/.test(name)).sort();
if (artifacts.length !== 2) throw new Error('Expected one DMG and one ZIP');
const lines = artifacts.map(name => crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex') + '  ' + name);
fs.writeFileSync(path.join(dir, 'SHA256SUMS'), lines.join('\n') + '\n');
fs.writeFileSync(path.join(dir, 'validation.json'), JSON.stringify({ platform: 'macOS', arch: 'arm64', minimumOS: '26.0', signing: 'ad-hoc', notarized: false, tests: 'passed', artifacts }, null, 2) + '\n');
