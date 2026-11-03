# 开发指南

[返回文档索引](README.md)

建议使用 **Node.js 24 + npm**，与仓库 CI 配置一致。依赖以 `package-lock.json` 为准。应用技术结构见[架构说明](architecture.md)，项目工作约定见 [AGENTS.md](../AGENTS.md)。

## 原生构建依赖

`dev` 和 `build` 均先执行 `scripts/build-dictation.mjs`，它会**先检查／生成 Windows 输入组件，再在 Mac 上编译双架构 Swift 组件**。生成二进制不在 Git 中，新克隆不能依赖开发机已有产物。

| 构建宿主 | 所需准备 |
| --- | --- |
| Windows x64 | .NET Framework 编译器与 WPF 参考程序集；脚本使用系统 `Framework64/v4.0.30319/csc.exe` |
| macOS | Xcode Command Line Tools（`xcrun swiftc`），以及下述 Windows 组件交叉编译依赖 |

在非 Windows 宿主上，准备官方 .NET SDK 和 NuGet 包 `Microsoft.NETFramework.ReferenceAssemblies.net48` 中的参考程序集，再设置：

```sh
export SPEAKBRIDGE_DOTNET_DIR="/absolute/path/to/dotnet-sdk"
export SPEAKBRIDGE_NET48_REFS="/absolute/path/to/net48/build/.NETFramework/v4.8"
```

两处都是本机绝对路径占位符，必须替换为实际目录。SDK 根目录应包含 `dotnet` 和 `sdk/`；参考目录应包含 `mscorlib.dll`、`UIAutomationClient.dll` 等 net48 程序集。历史交叉编译使用 .NET SDK 8.0.427，见[0.6.0 构建记录](archive/releases/0.6.0-dictation.md)。本次整理没有重新做空白机器安装验证。

Windows 组件源码／产物哈希记录在 `electron/native/dictation-win.build.json`。构建更新该清单时，应审查是否由预期编译器和源码产生，不能用旧二进制绕过检查。安装包用户无需这些开发工具。

## 获取源码与启动

```sh
git clone https://github.com/aimasteracc/speakbridge.git
cd speakbridge
npm ci
npm run dev
```

仓库当前为私有，需要有读取权限的 GitHub 账户。`npm ci` 不会下载语音模型；通过应用设置按需准备。

| 命令 | 用途与前提 |
| --- | --- |
| `npm run dev` | 编译原生组件、构建 ASR 运行时，启动完整 Electron 开发环境 |
| `npm run dev:web` | 只启动前端；完整录音、IPC 和存储需要 Electron，UI fixture 可用于隔离验证 |
| `npm run build` | 原生组件 + ASR 运行时 + TypeScript 检查 + Vite 生产前端 |
| `npm start` | 使用现有构建运行 Electron，应先完成 `build` |
| `npm run check:sensitive` | 常见凭据、私人路径和文件检查；范围与限制见[数据与隐私](security.md) |

## 按改动选择验证

| 验证 | 命令 | 边界 |
| --- | --- | --- |
| 逻辑与协议 | `npm test` | Node 测试、存储、本机模拟 WebSocket／HTTP，不代表真实设备或云端成功 |
| 通用 Electron 流程 | `npm run test:e2e` | 先构建；隔离 userData、合成音频、本地模拟 API |
| 听写设置与进度 UI | `node tests/dictation-cleanup.e2e.cjs`、`node tests/dictation-readiness.e2e.cjs` | 浏览器固定 fixture；不是原生自动输入验收 |
| 纪要 UI 夹具 | `node tests/history-ui-fixture.cjs` | 启动隔离 Store / 固定资料服务，需配合浏览器执行生成、失败和取消场景；启动服务本身不是测试通过 |
| 打包配置持久化 | `node tests/dictation-cleanup-package.cjs` | Mac，要求 `release/<version>/` 下已有当前包；独立空 userData，不录音 |
| 固定录音评测 | `npm run test:asr` | 需要语料、模型、Python 下载脚本和 ffmpeg；方法见[0.3](archive/reports/asr-quality-0.3.md)与[0.4 报告](archive/reports/asr-quality-0.4.md) |

真实文字模型测试是单独步骤，会使用对应服务或本机模型，不能当成无网络单元测试自动运行：

```sh
node tests/dictation-cleanup-live.cjs codex
node tests/dictation-cleanup-live.cjs ollama YOUR_LOCAL_MODEL
```

这些是合成文字的整理验收，不测麦克风、ASR CER/WER 或原版软件。需要真实原生输入时使用对应测试夹具，并确认隔离数据、目标窗口与剪贴板影响；测试不能终止用户正在进行的录音。

文档修改检查链接、索引、命令及默认值引用、敏感信息和 diff。没有产品行为变化时，无需重做音频或付费服务调用。通过的验证与未完成项统一记录到[验证状态](verification.md)。

图片与教程视频的来源、隔离范围和重制命令见[媒体维护说明](guides/video-tour.md#素材来源与维护)。这些脚本只运行教程夹具，不进行真实设备或云端模型验收。

## 打包与 CI

| 命令 | 产物 |
| --- | --- |
| `npm run pack:mac` | Mac arm64 / x64 ZIP，需 Mac 宿主 |
| `npm run pack:win` | Windows x64 ZIP，原生 Windows 构建优先 |
| `npm run dist:mac` | 当前构建架构 DMG |
| `npm run dist:win` | Windows x64 NSIS 安装器 |

默认输出目录为 `release/`。已有版本化校验脚本 `scripts/verify-package.cjs` 则读取 **`release/<package.version>/`**，并要求其中有 Mac 双架构、Windows x64 解包目录和三个 ZIP；两种目录约定不能混用。需要该校验时可在完成 `npm run build` 后使用：

```sh
npx electron-builder --mac zip --arm64 --x64 --config.directories.output=release/0.7.11 --publish never
npx electron-builder --win zip --x64 --config.directories.output=release/0.7.11 --publish never
node scripts/verify-package.cjs
```

版本目录需与 `package.json` 一致。上述完整校验在 Mac 上使用 `codesign`、`file`、`unzip`，检查源文件、原生架构、Mac 严格签名、ZIP 完整性，并生成 SHA-256 清单；它不是跨平台实机启动测试。修改配布文档后，旧包的内容也不等同于新源码，需要重新打包才能宣称一致。

保留 `asarUnpack` 的 ONNX Runtime、sherpa-onnx 和原生输入组件配置，以及根目录许可证和 `licenses/`。模型不内置。Mac 当前为 ad-hoc 签名，未做开发者签名／公证；Windows 未配置发布签名。

[GitHub Actions 工作流](../.github/workflows/build.yml)仅由手动执行或 `v*` 标签推送触发，普通分支推送不触发。它使用 macOS / Windows runner 执行敏感信息检查、安装、测试、构建和打包，再上传 Actions artifacts；没有自动创建 GitHub Release。

截至 2026-11-03 远程运行记录为 0。macOS job 尚未配置上述 .NET 交叉编译路径，空白 runner 仍有构建前置条件缺口；本次只整理文档并修正脚本帮助路径，没有修改 CI 或把它记为已通过。

## 自定义 Harness 协议

设置可执行文件绝对路径及 JSON 参数数组。应用以 `shell: false`、临时空工作目录启动，每次请求一个进程：

```json
{"instructions":"转换要求","input":"被引用的资料 JSON 或文本"}
```

该对象作为一行 JSON 写到 stdin，随后 EOF；stdout 只输出最终 UTF-8 文本，诊断写 stderr，失败退出非零。Windows 自定义 `.cmd` / `.bat` 不支持；可使用 Node / Python 可执行程序配合脚本路径参数。

适配器默认 CLI 超时 45 秒，听写整理覆盖为 15 秒，纪要使用其设置的超时（默认 600 秒）。CLI 输出以字符串长度 512,000 为上限，不是精确字节限制；单服务任务串行。自定义程序的工具和外部调用由开发者自己约束。
