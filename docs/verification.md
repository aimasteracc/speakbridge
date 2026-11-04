# 当前验证状态

[返回文档索引](README.md)

更新日期：**2026-11-04**。当前源码版本 **0.8.0**；本次仅开发本地工作区功能。下表明确区分合成验证、打包应用与真实设备验收。没有替换或重启用户已安装的声桥，没有访问真实会议或调用付费 API。

## 0.8.0 功能与平台证据

| 项目 | 已验证 | 尚未验证或限制 |
| --- | --- | --- |
| 逻辑与协议 | 131 项 Node 测试通过；TypeScript、生产构建通过；媒体顺序写入、字节范围播放、索引失败保留、快捷键冲突回滚、剪贴板限额、问答取消、语言能力校验有覆盖 | 测试通过不代表所有硬件、目标应用或云服务可用 |
| MP4 与截图 | Electron 隔离目录：区域 PNG 为 480×270；合成画面和音频录为 H.264/AAC MP4；内联播放、暂停、恢复、停止、重启与独立删除通过 | 手动滚动合成画面成功从 300 拼接为 421 像素，MP4 抽查 5 帧均有变化；真实屏幕权限、系统音频回环、长时间录制仍需实机验收 |
| 打包应用 | Mac arm64 0.8.0 包内录屏、回放、裁剪、真实本地英文 OCR、Word/PDF 导出及重启恢复通过 | 未替换用户安装；Mac 为 ad-hoc 签名，未完成开发者签名和公证 |
| 通用会议流程 | 8 组 Electron 场景通过：演示、双语字幕、历史、隔离凭据、本地模拟 API、合成音频、暂停不发送 PCM、浮动工具栏恢复、会议录屏共用混音并随会议保存、纪要及重启 | 自动会议提醒的真实应用检测、长会自动停止／自动纪要仍需设备与服务验收 |
| 听写 UI | 新快捷键编辑、权限状态、整理服务选择、保存失败、原文／结果复制、取消、深色与最小窗口 fixture 通过 | 本轮没有重新验收真实听写到 Codex；没有用新 UI 测试结果替代原生输入验证 |
| 原生组件 | Mac arm64 / x64 Swift 与 Windows AnyCPU C# 编译通过；GitHub 的 Mac、Windows x64 / arm64 上均通过空绑定、剪贴板计数及清理协议，以及原生 ASR 库加载 | 鼠标中键／侧键和按住释放需真实硬件验收；Windows / Intel Mac 实机 pending |
| 屏幕问答 | 本地 OCR 确实读出合成截图中的 SpeakBridge；记忆 opt-in、取消与独立删除测试通过；本地 HTTP fixture 验证问答 UI 只发送确认文字及勾选记忆 | 只提取文字，不解释图片／图表；问答沿用所选文字引擎，API / CLI 可能联网收费 |
| Word / PDF | DOCX OOXML 表格与 Unicode 校验；Electron 导出 PDF 成功，渲染后目视检查中日表格与标题 | 未在所有 Office 版本逐一验收 |
| Windows arm64 | Windows 11 arm64 runner 上安装依赖、131 项测试、构建、原生协议、ASR 库加载、NSIS / ZIP 打包及上传全部通过 | 配置与编译不代表 ARM Windows 安装、驱动、输入和录屏均通过；需 .NET Framework 4.8.1 |
| 依赖与隐私 | 生产依赖 `npm audit --omit=dev` 无已知漏洞；新增依赖许可随包分发；测试使用合成资料和独立目录 | 开发依赖链仍有 audit 告警，不使用强制降级绕过；扫描不保证发现所有秘密 |

复现入口：`npm test`、`node tests/electron.e2e.cjs`、`node tests/workspace.e2e.cjs`、`node tests/dictation-readiness.e2e.cjs`、`node tests/dictation-cleanup.e2e.cjs`、`node tests/native-protocol-smoke.cjs`。打包工作区验收可设置 `SPEAKBRIDGE_TEST_EXECUTABLE` 为当前可执行文件绝对路径。工作区测试首次 OCR 会下载英文模型，不上传截图或使用付费 API。

本机证据位于 `test-artifacts/workspace/`、`workspace-package/` 和听写测试目录，不纳入 Git。截图／录音均为合成样例。现行功能与使用限制见[本地工作区指南](guides/local-workspace.md)，完整需求对应见[功能范围](local-features-plan.md)。

## 既有语音与文字能力的证据边界

0.7.11 的 Codex 固定文本整理为 8/8 预期结果，本机 Ollama `qwen3.5:2b` 为 3/8；这不是 ASR 准确率。0.7.10 的多语言、473 段长会议请求、取消及旧纪要保留通过模拟验证；当次真实服务返回 503，不是当前服务健康结论。本轮未重做 DeepSeek 实际会议或同音频原版对比，不能声称识别率提高或超过 Speakly / Typeless。

原始方法与限制见[0.7.11 听写记录](archive/releases/0.7.11-dictation-cleanup.md)、[0.7.10 纪要记录](archive/releases/0.7.10-meeting-notes.md)、[0.4 语音评测](archive/reports/asr-quality-0.4.md)和[旧版 QA 汇编](archive/reports/qa-history.md)。历史报告中的通过仅适用于其版本与场景。

## 仓库、构建和发布

公开仓库为 `aimasteracc/speakbridge`，默认分支 `main`。0.8.0 在 `codex/workspace-features-20261104` 开发，旧源码保留标签 `v0.7.11-before-workspace-features-20261104`。本机 ZIP 与 GitHub Release 是不同交付；本轮不自动发布正式 Release。

CI 已补齐 .NET SDK / net48 参考程序集准备及 Windows arm64 job，仅手动或 `v*` 标签触发，上传 Actions artifacts。针对功能提交 `87fa155` 的 Mac、Windows x64、Windows arm64 三项远程 job 全部成功；每项执行敏感信息扫描、131 项测试、构建、原生协议和 ASR 库加载，再打包上传。四个平台的本机 ZIP 已重新构建：各 62 个应用／许可文件与源码匹配，ASR 库架构及 Windows AnyCPU 标志正确，ZIP 完整性与 SHA-256 通过，Mac 双架构严格 ad-hoc 签名通过。证据为 `test-artifacts/package-0.8.0-verification.json`，校验值在 `release/0.8.0/SHA256SUMS.txt`。源码开发提交 `87fa155` 已推送并建立 [PR #1](https://github.com/aimasteracc/speakbridge/pull/1)，[远程 CI](https://github.com/aimasteracc/speakbridge/actions/runs/41753799447) 全部通过。后续文档提交不改变包内运行代码。

## 公开前的隐私处理（2026-11-04）

- 4 个提交的作者及提交者邮箱替换为 GitHub 隐私邮箱，后续提交编号随父提交更新；逐个比对原有 8 个提交的文件树，内容完全一致。
- 对脱敏历史的 223 个文本对象及提交元数据运行项目敏感信息规则，未检出命中；6 个二进制对象为已审查的项目图片与教学视频。此检查不等同于对任意秘密的保证。
- GitHub 在改写分支后仍保留可按旧编号读取的提交，因此公开仓库使用独立仓库承载脱敏历史；原仓库保留为私有归档，避免将旧提交缓存一同公开。
- README 的视频附件随公开仓库重新上传；本地 Git 配置改用隐私邮箱，应用代码、用户配置和安装包不变。
- 公开后以无登录请求验证仓库及 README 返回 200；从匿名 README 的播放器地址读取完整 MP4，SHA-256 与本地原片一致。旧提交编号及私有归档均返回 404；匿名克隆后的 9 个提交、228 个历史文本对象扫描无命中。

## 文档重整提交 5ef8a25 的核对面

| 事实面 | 状态 | 处理 |
| --- | --- | --- |
| 代码行为 | `verified-current` | 对照配置默认值、引擎路由、输入流程、存储、Markdown 与构建入口；功能代码不变 |
| 当前用户运行态 | `pending` | 不读取真实会议、改变权限、停止录音或重启应用；沿用上表的验收边界 |
| 文档 | `changed-and-verified` | 建立索引与现行指南，移动历史材料，修正链接及过期说明 |
| 项目规则 | `changed-and-verified` | 增加精简 AGENTS.md，链接现行开发与验证说明，不复制私人宿主路径 |
| 宿主记忆 | `out-of-scope` | 文档任务不修改或新建长期记忆 |
| 工作区 | `verified-current` | 一个工作树；归档保留历史材料、设计图与许可文本，不删除分支、测试产物或模型 |

文档重整提交 `5ef8a25` 时的检查结果：32 份文档均可从 README 到达，223 处本地链接及其目标有效；22 个归档文件保留原内容（仅调整历史标记与导航），两张概念图与原哈希一致。示例中的 npm 命令及脚本入口存在，敏感信息检查覆盖 145 个源码文本文件、无命中，diff 与脚本语法检查通过。

没有把文档维护当作新一轮产品、模型或 API 验收，也没有为此运行真实会议、录音或付费服务测试。

## 图片与上手视频（0.7.11）

[图文与视频指南](guides/video-tour.md)使用当前 React 界面和隔离的虚构资料。新增制作脚本及文档素材，应用功能代码、依赖和原生组件没有变更。

- 正常速度录制得到 113.875 秒、1920 × 1080、24 fps、H.264 / yuv420p 视频；全片解码通过，无音轨。16 条中文字幕已嵌入画面，并提供 SRT / VTT。
- 录制期间页面错误为 0、外部 HTTP 请求为 0；没有真实用户数据、凭据、麦克风或原生输入调用。界面的转写、模型响应与跨应用输入结果是明确标注的模拟数据。
- 编码后抽查开场、设置、纪要、听写和收尾画面；修正了示例输入框的字号及提示遮挡。字幕有序且结束时间在最后一帧范围内。
- 本地播放页通过直接打开文件、视频播放、章节跳转和 390 px 窄屏无横向溢出检查。7 个交付文件记录 SHA-256。
- 2026-11-04：README 与视频指南改用 GitHub 附件播放器，流程图折叠显示。GitHub README 预览中点击播放及跳转到 50 秒通过，媒体为 1920 × 1080、113.875 秒，无播放错误；仓库 MP4 和字幕继续保留供离线使用。
- 该结果是教学素材验证，不替代上方待完成的真实 API、设备及目标应用验收。版本、编码与章节数据见[视频清单](media/video-manifest.json)。
