# 来源与许可证范围

## 文件来源

`rtl/`（305 个 .sv/.v）、`design.f`、`waveform-top.sv` 和本机 `wave/llc-256k.fst` 来自提供的 OpenLLC 生成产物。为避免泄漏本机目录结构，已删除生成 RTL 中包含绝对路径的源码位置注释，保留代码逻辑与行号，并补充文档和许可证，没有导入任何上游原始 Chisel/Scala 源码或完整仓库。

生成文件标注 CIRCT firtool-1.149.0，并引用 XSCache、utility、Rocket Chip、OpenNCB 和 Chisel util 来源。以下提交记录来自本机对应生成工程的上游检出版本；生成配置含本地 256 KiB 测试顶层，不能据此声称这些 RTL 等同于上游默认配置的原样构建。

| 来源 | 版本依据 | 随附许可证/声明 |
|---|---|---|
| [OpenXiangShan/XSCache](https://github.com/OpenXiangShan/XSCache/tree/a041f0750e8aa2a831298977e3fac3fbdde7c93b)，含 OpenLLC 与 CoupledL2 | `a041f0750e8aa2a831298977e3fac3fbdde7c93b` | 根目录 `LICENSE`（Mulan PSL v2），`licenses/XSCache-LICENSE.SiFive` |
| [OpenXiangShan/utility](https://github.com/OpenXiangShan/utility/tree/eb8e12b00a33e4716e7778175f6dd45b7a3a9ede) | `eb8e12b00a33e4716e7778175f6dd45b7a3a9ede` | 对应源文件声明 Mulan PSL v2，见 `LICENSE` 和 `NOTICE` |
| [OpenXiangShan/rocket-chip](https://github.com/OpenXiangShan/rocket-chip/tree/dc2d83f5511232a228e3cb90a3aeba474d8ee702) | `dc2d83f5511232a228e3cb90a3aeba474d8ee702` | `licenses/rocket-chip-LICENSE.Berkeley`、`rocket-chip-LICENSE.SiFive`、`rocket-chip-LICENSE.jtag` |
| Rocket Chip CDE | `52768c97a27b254c0cc0ac9401feb55b29e18c28` | `licenses/cde-LICENSE` |
| [Chisel](https://github.com/chipsalliance/chisel/tree/v7.13.0) | XSCache 的构建声明为 `7.13.0` | `licenses/chisel-LICENSE`；仅附许可证，不附 Chisel 代码 |
| [OpenXiangShan/OpenNCB](https://github.com/OpenXiangShan/OpenNCB/tree/9a83eb7e6c0e36e0d6b72642ff93641ec65819cf) | `9a83eb7e6c0e36e0d6b72642ff93641ec65819cf` | 该提交根目录没有独立 LICENSE，检查的生成来源文件也未发现许可声明；许可范围待上游确认，未自行套用 Mulan 或 Apache 许可证 |

## 保留范围

OpenLLC 主体的 Mulan PSL v2 原文来自上述 XSCache 提交的 `LICENSE`。附带依赖许可文本保留其原文及版权归属；不改写生成 RTL 的模块或接口，仅删除包含本机绝对路径的源码位置注释，保留版权与许可声明。

该目录是用户提供的生成产物的本地整理。尤其是 OpenNCB 的许可缺口，没有因添加其他组件的 LICENSE 而解决；对外发布完整生成测试平台前需确认这一依赖的授权范围。此说明不赋予原始材料未授予的额外权利。
