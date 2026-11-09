// SPDX-License-Identifier: Apache-2.0
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
module.exports = {
  outDir: 'dist/desktop/forge',
  packagerConfig: {
    name: 'RTL Browser', executableName: 'RTL Browser', appBundleId: 'org.rtl-browser.desktop',
    appCategoryType: 'public.app-category.developer-tools',
    asar: true, prune: false,
    // Only the shell and its metadata belong in app.asar. Runtime is an explicit extra resource.
    ignore: file => !!file && !['/package.json', '/apps', '/apps/desktop', '/apps/desktop/main.cjs', '/apps/desktop/preload.cjs'].includes(file.replaceAll('\\', '/')),
    extraResource: [path.resolve('dist/desktop/runtime')],
    extendInfo: { LSMinimumSystemVersion: '26.0', NSHighResolutionCapable: true },
    download: { cacheRoot: path.resolve('.sandbox/cache/electron') },
  },
  makers: [
    { name: '@electron-forge/maker-dmg', config: { format: 'ULFO' } },
    { name: '@electron-forge/maker-zip', platforms: ['darwin'] },
  ],
  hooks: {
    packageAfterCopy: async (_config, buildPath) => {
      const pkg = JSON.parse(fs.readFileSync(path.join(buildPath, 'package.json'), 'utf8'));
      fs.writeFileSync(path.join(buildPath, 'package.json'), JSON.stringify({ name: pkg.name, productName: pkg.productName, version: pkg.version, main: pkg.main, license: pkg.license, description: pkg.description }));
    },
    postPackage: async (_config, result) => {
      for (const dir of result.outputPaths) {
        const app = path.join(dir, 'RTL Browser.app');
        execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app]);
        execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
      }
    },
  },
};
