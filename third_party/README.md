# Third-party notices

The project pins dependencies in `tools/deps/versions.json`; build scripts
download them into `.sandbox/deps/` and do not install them into the host
system. License texts for the components relevant to redistribution are
collected under `licenses/`.

| Component | Pinned version/commit | License file |
|---|---|---|
| libfst (with FastLZ / LZ4) | `bf53e719f099729cedc6e4e5d5400f79bd80c610` | `libfst/LICENSE` (MIT / BSD) |
| zlib (FST worker) | `v1.3.1`, `51b7f2abdade71cd9bb0e7a373ef2610ec6f9daf` | `zlib/LICENSE` |
| slang | `545f88b2ed3a2d20325fbd17413af177a6bca72f` | `licenses/slang-LICENSE.txt`, `licenses/slang-LICENSES/` |
| Node.js | 24.22.1 | `licenses/node-LICENSE.txt` |
| SQLite | 3.45.1 amalgamation | `licenses/sqlite-NOTICE.txt` |
| nlohmann/json | 3.11.3 | `licenses/nlohmann-json-LICENSE.MIT` |
| React / React DOM / Scheduler | 19.3.1 | `licenses/react-LICENSE.txt`, `licenses/react-dom-LICENSE.txt`, `licenses/scheduler-LICENSE.txt` |
| Vite | 8.3.5 | `licenses/vite-LICENSE.md` |
| TypeScript | 5.9.3 | `licenses/typescript-LICENSE.txt` |
| playwright-core | 1.64.1 | `licenses/playwright-core-LICENSE.txt` |
| Rolldown (Vite dependency) | installed by npm lock | `licenses/rolldown-LICENSE.txt` |
| OpenLLC generated RTL example | see `examples/openllc-256k-rtl-wave/SOURCE.md` | `examples/openllc-256k-rtl-wave/LICENSE`, `licenses/`, `NOTICE`; OpenNCB license status noted in `SOURCE.md` |
| verilog-axi example/test fixture | `516bd5dadc3365b7f9e225d2af8fe0b8d804fe53` | `examples/axi-crossbar/licenses/COPYING` |

`npm` dependencies resolved by `package-lock.json` may carry additional
licenses in their own packages under `node_modules/`; this table covers the
direct runtime/build dependencies of the vertical slice.
