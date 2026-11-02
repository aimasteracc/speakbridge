# 声桥 · SpeakBridge

参照给定的 Speakly 截图实现的独立桌面应用。中文界面，面向 Windows 和 macOS，包含真实音频采集、API 优先、本地 SenseVoice / Qwen3-ASR / Whisper、Codex / Claude Code、DeepSeek Harness、Ollama 与自定义适配器。

## 源码中的敏感信息

提交或分享源码前运行 `npm run check:sensitive`。检查只输出文件、行号和类别，不输出疑似凭据原文；它是常见格式检查，不能替代人工审查。个人配置、密钥、录音、测试截图、原版分析副本和本机调试记录不要放入源码。`node_modules/`、`dist/`、`release/`、`test-artifacts/` 已排除 Git 提交；分享源码时同样排除这些生成目录。

2026-11-02 的清理范围、保留项和验证结果见 [敏感信息清理记录](PRIVACY-CLEANUP.md)。历史文档中引用的截图、原版原始证据和用户安装记录已移至本机私有备份，不再随项目提供；可公开的文字分析及脱敏测试摘要继续保留。

## 功能

- 麦克风、系统音频、麦克风与系统混合采集。
- API 流式转写或本地语音模型分段转写，支持三模型复核；中文、日文、英文等 7 种目标语言。
- 语音与文字引擎独立选择；无 API Key 时可使用已登录的 Codex / Claude Code，或本机 Ollama。
- 可拖动、可调整大小、始终置顶的双语字幕窗口。
- 本地会话历史、全文搜索、重命名、收藏、删除、复制。
- TXT、Markdown 和双语 SRT 导出。字幕时间为客户端音频分段的近似时间，不是词级对齐。
- 个人术语词典、根据已保存的会话生成会议纪要。
- 全局快捷键：`Cmd/Ctrl + Shift + Space` 开始/结束，`Cmd/Ctrl + Shift + L` 显示/隐藏字幕。
- API Key 通过 Electron safeStorage 使用系统机制加密，渲染页面不会收到密钥。
- 演示模式使用明确标注的预设中日双语文本，不录音、不调用 API。

## 直接运行

本次验证产物在 `release/0.7.8/`（常规打包命令默认输出到 `release/`）：

- macOS Apple Silicon：`SpeakBridge-0.7.8-mac-arm64.zip`
- macOS Intel：`SpeakBridge-0.7.8-mac-x64.zip`
- Windows x64：`SpeakBridge-0.7.8-win-x64.zip`

Mac 解压后将 `SpeakBridge.app` 放入“应用程序”并打开；Windows 解压整个目录，运行 `SpeakBridge.exe`。不要只移动 exe，需保留同目录文件。Mac 使用本地 ad-hoc 签名，未使用开发者证书或 Apple 公证，适合内部试用；本地签名不保证升级后保留权限，公开分发前需要稳定的开发者签名与公证。

## 0.7.8 日本語の議事録と Markdown 表示

- 議事録は「会議概要・アジェンダ・議事内容・決定事項・アクションアイテム・次回以降の主な論点・会議の位置づけ」の7項目と末尾のメモで生成します。
- 資料にない日時・担当者・期限は「不明」または「未定」とし、提案や未決事項を決定扱いしないよう指示します。固有名詞は保持し、アクションの状態は「未着手」に統一します。
- 現在の入力元は保存された文字起こしです。種類を明示して渡し、中断・未確定部分があれば部分資料として扱います。通常終了でも会議全体の網羅性は保証せず、注記するよう指示します。アプリの記録日時・自動タイトルは会議の事実として送信しません。
- Markdown の見出し・表・箇条書き・強調・コードを整形表示。表は横スクロール、長文は本文領域内でスクロールできます。元の Markdown はそのまま保存・エクスポートされます。HTML を実行せず、画像は代替テキスト、リンクはテキストとして表示します。
- 既存議事録の「重新生成」で新しいテンプレートを適用できます。確認後に生成し、成功するまで旧本文を保持します。生成エラー・空の結果・API / Ollama が明示した出力上限による中断は保存しません。
- 議事録のみ API / Ollama の出力枠を8192トークン、処理期限を180秒に拡張。翻訳の既存設定は維持します。CLI の出力上限は各サービスに依存します。モデルが常に指示どおりに生成することを保証する機能ではありません。
- 表の表示には [react-markdown](https://github.com/remarkjs/react-markdown) と [remark-gfm](https://github.com/remarkjs/remark-gfm) を使用しています。検証範囲は [QA.md](QA.md) を参照してください。

## 0.7.7 全选与批量删除

- 「会话历史」和「会议纪要」列表提供勾选框、全选、取消选择与删除所选；逐条删除继续保留。
- 全选只选中当前搜索 / 收藏筛选结果中的可删除记录；切换筛选会清空旧选择，部分选择显示半选状态。正在进行的会话、没有纪要的纪要行不可选。
- 删除前显示所选条数和范围。会话历史删除会话及其转写、翻译、纪要；会议纪要只删除纪要，保留原文和翻译。变更选择后需重新确认。
- 批量操作一次写入本机文件；任何所选 ID 已失效、正在进行或写盘失败时，整批保留。迟到的后台结果不能恢复已删除内容。

## 0.7.6 逐条删除记录

- 首页、实时翻译和会话历史的每条记录旁直接显示「删除」，原位置确认一次即可删除这条会话的转写、翻译和纪要。0.7.6 仅支持逐条删除；0.7.7 已增加全选与批量删除。
- 会议纪要页面和详情的纪要标签页可单独删除这一份纪要，保留对应转写、翻译与其他会话。
- 语音输入页可清除当前已结束的听写结果；不会撤回已输入其他应用的文字或改动系统剪贴板。
- 正在录音或输入的记录受到保护；写入失败会保留记录；后台迟到的翻译/纪要结果不能恢复已删除内容。
- 单条删除在本机持久化；外部已经导出的文件不属于应用历史，不会随之删除。验证范围见 [QA.md](QA.md)。

## 0.7.5 听写流程改造

根据本次 REA 对原版输入链路的分析，将识别与输入框上下文探测分离，启动立即反馈，结束后自动交付；输入目标不明时保留文字。写入过程中等待剪贴板恢复，避免取消导致残留。失败结果可展开查看不含正文的输入诊断。

证据、与原版的差异及未知项见 [REA 对照报告](REA-DICTATION-0.7.5.md)，测试范围见 [QA.md](QA.md)。最终 Mac arm64 包已验证固定文字向原生、网页及富文本框写入，以及密码框拒绝和选区补填。真实麦克风与全局快捷键完整流程、当前 Codex 输入框仍未完成实机验收。

## 0.7.4 悬浮条点击失焦修复

- 修复 Mac 鼠标点击「填入」时激活声桥、导致目标输入框丢失的问题。悬浮条改用真正的非激活面板，并接收第一次鼠标点击；不再触发普通窗口跨桌面的 Dock 状态转换。
- 保留原有输入框/选区/密码框保护与 `⌘ + Shift + D` 免持快捷键。窗口行为修复没有更换识别模型。
- 0.7.3 的无障碍按钮操作测试不能代替真实鼠标点击验收；0.7.4 的实际验证范围见 [QA.md](QA.md)。

## 0.7.3 自动输入修复

- 录音前定位实际输入框；找不到可编辑位置时立即提示，避免录完才发现无法输入。Mac 会开启 Chromium 的辅助功能树，并查询系统、应用和窗口中的实际焦点。
- Mac 自动输入改用编辑器正常粘贴流程，避免网页控件返回写入成功却没有正文或输入事件。临时剪贴板内容限定本机，完成后恢复原有数据与格式；若期间用户复制了新内容，则保留用户的新内容。不自动按回车。
- 零写入失败可「选择输入框并填入」：点进目标输入框后，在悬浮提示点「填入」，无需重新口述。无法确认是否已写入时提示检查，不提供可能造成重复的直接重试。
- 新增「测试自动输入（不录音）」使用固定测试文字检查目标应用，不调用语音模型、API 或麦克风。
- 本地启动不再访问钥匙串；只有实际使用或保存 API 密钥时访问系统加密存储。没有改动已有密钥和识别模型。
- 实测结果与尚未验证的范围见 [QA.md](QA.md)。

## 0.7.2 Mac 授权修复

- 修复跳过签名后残留 Electron 签名、应用包完整性校验失败的问题；两个 Mac 架构均由打包工具重新生成完整的本地签名。
- 发布校验增加 `codesign --verify --deep --strict` 和签名应用标识检查，防止文件内容检查通过而系统仍无法识别应用。
- 没有右 Option 的键盘可关闭「按住说话」，使用 `⌘ + Shift + D` 免持听写。按一次开始，再按一次结束并输入，不自动发送。
- 本版没有改动识别模型；实际授权结果与验证范围见 [QA.md](QA.md)。

## 0.7.1 快捷键与授权修复

- Mac 的新配置默认按住「右 Option」，Windows 仍为右 Alt；已明确保存的 Fn 选择保持不变。Fn 可与系统输入法、表情或听写动作冲突，快捷键页提供直接改用右 Option 的按钮。
- 听写页只根据当前选中的模式显示就绪状态；免持键注册成功，不再被当成按住键可用。缺权限时先显示「待授权」，不提示直接按键开始。
- 从主应用请求辅助功能权限；显式重新检查或主应用已获授权但输入组件仍未获授权时，重启自有输入组件并重试一次。不会自动更改系统权限。仍未生效时提示核对旧版本授权条目。
- 56 项单元测试、4 组界面状态检查与 4 组权限恢复检查通过；安装包验证与实际按键结果见 [QA.md](QA.md)。

## 0.7.0 操作体验

- 对照原版公开帮助中的按住说话流程：Mac 默认按住 `fn / 🌐`，Windows 默认按住右 `Alt`，松开后定稿并输入。可改为右 Option / 右 Ctrl，或关闭按住模式。
- 保留 `Cmd/Ctrl + Shift + D` 免持听写，开始与结束各按一次；快捷键页可修改，两种方式可独立关闭。占用时提示并保留之前的配置。
- 440 × 132 的非激活悬浮提示显示真实音量、最新识别文字与结束／取消按钮。按键开始立即出现准备反馈；成功输入后自动收起，失败结果保留供复制。`Esc` 取消。
- 首次使用在「语音输入」点「准备开始」，统一检查麦克风、输入权限、模型和快捷键；只预载已安装本地模型。关闭主窗口后保留菜单栏／托盘，仍可听写；从菜单退出。普通会议关窗仍会结束并保存。
- 模型启动期间在内存暂存音频，松开立即停止采集，准备好后按顺序识别，避免因模型启动而漏掉开头。本版不更换模型，不将操作改善宣称为识别率提升。
- 说明和原版证据：[0.7.0 操作改造](USABILITY-0.7.md)。本地听写的数据边界延续 0.6.0。

## 0.6.0 跨应用本地听写

- 新增「语音输入」页面。在其他应用的普通输入框中按 `Cmd/Ctrl + Shift + D` 开始，再按一次定稿并输入；原有会议快捷键不变。
- 悬浮窗口不抢焦点，初稿只在窗口中更新，定稿后才输入；不自动发送。遇到焦点变化、权限不足或不兼容控件时保留结果；0.7.3 起 Mac 使用临时本机剪贴板粘贴，并提供安全补填入口。
- 听写始终使用本地模型与麦克风，关闭翻译，不保存到会话历史；已有 API 设置不影响听写，也不会被修改。单次最多 2 分钟。
- Mac 首次使用需麦克风与辅助功能权限。Windows 不支持向更高权限窗口注入输入。Windows 与 Intel Mac 已打包，但跨应用输入尚未实机验收。
- 使用方法、数据边界、构建与测试见 [0.6.0 听写说明](DICTATION-0.6.md)。

## 0.5.2 连续出字与纯标点过滤

- 本地与云端转写对完整假设过滤纯标点空段，如单独的“。”、“……”；不显示、不保存新空段、不请求翻译。正常句尾、独立返回但属于同一句的标点 token、小数、日期、短答与多语言内容保持原样。
- 初稿最终被撤回时会移除对应行；历史中的旧纯标点行只在界面隐藏，不改写旧记录。旧导出内容仍来自原始历史。
- 新内容按 Unicode 字素连续展开，每字约 28 ms，长批次最多 360 ms 补齐。包括 SenseVoice 改写临时句号后继续说话的情况。已显示部分的纠错直接替换为新稿；新结果取消旧动画，定稿、历史查看及系统“减少动态效果”直接显示完整文本。
- 保留 0.5.1 的固定字幕字号、录音阅读区、单行译文预留空间、跟随 / 暂停 / 回到最新。逐字换行时也保持阅读锚点。
- **本地 SenseVoice 仍按音频窗口识别**，这一版改善连续显示及无效结果过滤，不把显示动画当成原生流式 ASR。原生云端流式可使用已接入的 Soniox，需要独立付费 Key；本次没有自动切换引擎或新增 API 费用。
- 检查方法、实测与边界见 [0.5.2 说明](STREAMING-DISPLAY-0.5.2.md) 和 [验证记录](QA.md)。

## 0.5.0 流式体验

- SenseVoice 和增强模式约每 0.8 秒尝试产生一版初稿。处理慢时只保留最新预览，完整定稿音频不丢弃；已显示的文字可随上下文修订。
- 增强模式的快速初稿使用独立 SenseVoice 进程，三模型复核期间仍能识别下一句，额外占用一份轻量模型内存。准确率机制沿用 0.4.0，停顿和完整句子分段保持不变。
- 新增 **Soniox 实时转写**：设置中主动选择、保存独立 Soniox API Key，使用官方 stt-rt-v5 流式协议。稳定文字追加、临时文字替换，句末及停止时等待最终结果。自动模式不会因为保存了 Soniox Key 而切换。
- Soniox 是付费云服务，会发送音频到 Soniox。翻译与纪要仍由所选文字引擎处理。保存设置不会发起收费请求；“保存并测试连接”会发送 0.1 秒静音并测试翻译，可能产生费用。没有有效密钥时可继续使用本地识别。
- 测量方法、结果与验证边界见 [0.5.0 延迟报告](STREAMING-0.5.md)。Soniox 只完成本机协议模拟和界面链路测试，没有真实云端速度或准确率结论。

## 本地识别模式

- **增强识别**：SenseVoice 快速显示预览，Qwen3-ASR 1.7B 与 Whisper Large v3 Turbo 在定稿时复核；只有另外两个模型对齐后达成一致的词句才会替换初稿。全部在本机运行，不调用文字大模型纠错。仍可能有误识别，不能保证每句话都更准。
- 增强模式首次下载约 **3.7 GB**，推荐至少 **16 GB 内存**，定稿较慢。各模式共享模型文件，无需重复下载。全新安装仍默认轻量 SenseVoice；已有设置不会自动迁移到大模型。
- 单模型选项：SenseVoice 约 240 MB；Qwen3-ASR 1.7B 约 2.4 GB，可使用个人词典提示；Whisper Large v3 Turbo 约 1.04 GB；Whisper Base 约 80 MB。
- 增强模式、Qwen3-ASR 与 Whisper Turbo 至少等待 1.2 秒停顿，避免句子中间的短停顿过早切分；增强模式约 0.8 秒尝试预览，其余两种约 4 秒；保留 24 秒最长分段及 1 秒重叠。SenseVoice 与 Whisper Base 保留原分段策略。
- Qwen3-ASR 及增强模式中的 Qwen 分支接收个人词典，词条合计含分隔符上限为 256 UTF-8 字节（约 85 个汉字）。词典是提示，不能保证复核最终采用；SenseVoice 与 Whisper 本身不接收词典。中文固定源语言下，Qwen 只做有限的年月日数字格式整理，不猜测或补全名称。
- 增强模式支持中文、日语、英语、韩语与自动识别。其他界面语言请选择 Qwen3-ASR 或 Whisper。选择不支持的语言时会在开始前提示。

公开录音的独立验证结果、复现命令和限制见 [0.4.0 识别报告](ASR-QUALITY-0.4.md)。目前没有原版 Speakly 对同一批录音的输出，**不宣称已超过原版**。本地识别没有 API 调用费用，云端翻译仍使用相应账户额度。

## 首次使用

1. 无需配置即可点击“先体验演示”，演示不采集声音。
2. 打开“设置”，选择引擎并保存。默认自动模式：有 OpenAI 兼容 API Key → API 转写与翻译；无 Key → 所选本地模型转写（默认 SenseVoice），文字依次选择已检测到的 Codex、Claude Code、DeepSeek Harness，否则尝试 Ollama。自动选择只发生在会话开始，不会因认证/额度错误悄悄切换服务。
3. 无 Key 路线需先点“下载语音模型”：默认下载约 240 MB 的 SenseVoice + Silero 人声检测模型，支持中、日、英、韩语及粤语（自动识别）。也可按上述说明选择增强模式、Qwen3-ASR 或 Whisper。模型下载后校验 SHA-256，之后在本机 CPU 运行，无需 Python、ffmpeg 或额外安装。
4. CLI 方式先在终端运行 `codex login` 或 `claude` 登录。应用沿用其官方 CLI 登录，不读取或复制登录凭证。Codex / Claude Code 通常仍使用云端和账户额度，**不等于离线或免费**。已测 Codex 0.153.4、Claude Code 2.1.183；旧版本不支持相关参数时需更新 CLI。
5. 完全离线请选择“本地语音模型 + Ollama”，先启动 Ollama 并在设置填写本机已有模型名。可用 `ollama list` 查看；本机已验证 `qwen3.5:2b`。应用不会自动下载大语言模型；请勿选择需要远程推理的 Ollama 云端模型。
6. 点击“保存并测试连接”，会建立所选语音引擎并翻译一句测试文本；云端方式会使用少量额度。
7. 选择音频来源、语言，开始会话。按系统弹窗允许录音。结束时 OpenAI 兼容 API 最多等待约 25 秒；Soniox 定稿与后续翻译分别最多等待约 25 秒；本地流程等待检测收尾最多约 15 秒、随后任务排空最多约 45 秒，未完成部分会提示，翻译可稍后重试。

### API 模式

默认地址 `https://api.openai.com/v1`，转写模型 `gpt-live-transcribe`，文字模型 `gpt-4.1-mini`。模型权限和额度由 API 账户决定。可独立组合“API 转写 + Codex 翻译”或“本地 Whisper + API 翻译”。自定义 API 须支持所选功能对应的 Realtime 转写协议 / Responses API，普通 Chat Completions 兼容服务不一定支持。

### DeepSeek Harness（dsh）

在“翻译与纪要引擎”中明确选择 **DeepSeek Harness**。语音引擎可选本地模型。应用检测 PATH、常见安装目录及已有 npx 缓存，不会自动联网安装 CLI；也可填写 dsh 可执行文件或 `lib/bin.js` 的绝对路径（JS 入口需要 Node.js）。配置目录默认 `DSH_HOME` 或 `~/.dsh`。

适配器调用官方 `dsh --profile headless --patch …`，读取原目录的 `settings.yaml` 和 `.credentials.yaml`，使用单独的临时 DSH_HOME，任务结束后删除临时会话。文字通过权限为 0600 的临时配置传递，避免命令行长度限制；不经过 shell。首方文本插件隐藏全部模型工具，并拒绝任何工具调用。不会加载原 Web profile 的插件或修改原 profile。

已验证本机 `@deepseek-ai/dsh 0.1.5-rc.1` 的真实 CLI 协议：模拟服务下输出、工具禁用、错误和隔离均通过。真实服务目前返回 `Insufficient Balance`，因此实际翻译仍需对应模型服务有可用额度。Harness 是模型运行框架，本身不能替代模型服务的凭证/额度，也不能直接识别声音。只有原 Web profile 中单独保存的自定义模型或插件不会被继承；需在标准 Harness 模型设置中配置，仅通过原 Harness Home 的 `.env` 保存的配置也不继承；请使用标准模型设置和凭证管理，或使用下述通用适配器。

参考：[官方 DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)、[headless 包](https://github.com/deepseek-ai/deepseek-harness/tree/ce7073d51254c26cd63b22a60835b8f948deb447/packages/bundle/headless)。项目仍在预览阶段，版本变化可能影响插件接口；不兼容会直接提示错误。

### 自定义 Harness

设置中选择“自定义 Harness”，填写**可执行文件绝对路径**和 JSON 参数数组。程序以 `shell: false` 启动，工作目录为临时空目录，每次请求启动一个进程；45 秒超时，单任务串行，输出上限 512 KB。请使用只处理文字的可信适配器；应用无法保证自定义程序不调用工具或外部服务。

- stdin：一行 JSON，形如 `{"instructions":"翻译要求…","input":"引用的会话 JSON…"}`，随后 EOF。
- stdout：只输出最终 UTF-8 文本；诊断写 stderr；失败退出非零。
- 可用系统 Node/Python 可执行文件 + 参数中的适配脚本路径。Windows 不通过 cmd.exe 解释文本；自定义 .cmd/.bat 不支持，Codex/Claude 标准 npm shim 会转为直接调用 JS 入口。
- Codex 使用只读沙箱、关闭 shell / web / apps 等工具、忽略用户配置、临时会话；Claude 使用 safe mode、空工具表与空 MCP 配置。转写被标为引用数据。自定义 Harness 的工具权限需由适配器自己限制。

本地流程使用 Silero 人声检测和连续重采样，按停顿分段。SenseVoice / 增强模式约每 0.8 秒尝试更新预览，其余本地模型约每 4 秒更新，停顿后定稿；SenseVoice / Whisper Base 超过 12 秒会优先寻找短停顿，增强模式 / Qwen3-ASR / Whisper Turbo 等待至少 1.2 秒停顿，连续发言最长约 24 秒，强制切分时保留 1 秒重叠并去除可确认的重复文字。预览可能修订，只将最终文字交给翻译。保留句内音频上下文，不宣称模型具有跨段文字记忆。个人词典用于 API 识别、Qwen3-ASR 提示（含增强模式中的 Qwen 分支）及文字翻译，不做强制词语替换。处理队列过多会明确提示或停止，原始音频不落盘。

## 平台与权限

| 平台 | 运行条件 |
| --- | --- |
| Windows | Windows 10 / 11 x64；麦克风需在系统隐私设置中允许桌面应用使用 |
| macOS | macOS 13+，Apple Silicon / Intel；推荐 macOS 14.2+ 使用系统音频 |

系统音频使用 Electron 的 `getDisplayMedia` 与系统 loopback。macOS 14.2+ 使用 CoreAudio Tap，必须授予“系统音频录制”权限。原生共享选择器可用时优先使用它；取消、未共享音频或已结束的音频轨道会提示错误，不能当作成功录音。屏幕视频轨道仅用于建立系统音频采集，不显示、保存或发送到服务。

开发模式运行时，macOS 可能把录音权限归属到终端或 IDE；请优先用打包后的应用测试系统音频。使用扬声器同时采集麦克风与系统声音可能包含回声，推荐耳机。麦克风或系统音频设备断开会结束并保存会话。会话超过云端连接上限或网络断开时会停止并保留已收到的文本，不会悄悄重连或重复计费。

## 开发

需要 Node.js 22.12+ 或 24+、npm。

```sh
npm ci
npm run dev
```

`npm run dev:web` 只启动前端服务器，录音与存储需要完整 Electron 环境。

```sh
npm test          # 纯逻辑、存储、真实本地 WebSocket 协议测试
npm run build    # TypeScript 检查与生产构建
npm run test:e2e  # Electron 界面 + 合成音频 + 本地模拟 API
npm run test:asr  # 离线真人录音对照（需先运行 scripts/fetch-asr-corpus.py 并准备两种模型）
npm run pack:mac  # Apple Silicon 和 Intel ZIP
npm run pack:win  # Windows x64 ZIP
npm run dist:mac  # 当前架构 DMG
npm run dist:win  # Windows NSIS 安装器（建议在 Windows 构建）
```

CI 配置在 `.github/workflows/build.yml`，分别在 macOS 与 Windows 原生 runner 构建；尚未在远程仓库运行。项目不会自动上传、发布或签名。

## 数据与隐私

会话文本与偏好保存在应用 userData 目录（设置页面显示准确路径）：macOS 通常在 `~/Library/Application Support/SpeakBridge`，Windows 通常在 `%APPDATA%/SpeakBridge`。`sessions.json` 是明文会话文本，`credential.json` 只保存系统加密后的密钥。

原始音频只在内存中短暂缓冲，不落盘。OpenAI 兼容语音引擎会发送音频到指定 API；Soniox 引擎使用固定官方地址，持续发送包括停顿在内的音频；全部本地语音模型（含增强模式）只在本机处理音频。API / Codex / Claude / DeepSeek Harness（云端模型）文字引擎会将转写与词典提示发送到对应服务；本机 Ollama 仅调用环回地址，需选已下载的本地模型。服务方仍适用其自己的数据政策。Responses 请求设置 `store: false`，这不代表服务方没有其他日志或保留策略。没有遥测、后台剪贴板监控或自动更新。

## 验证范围

测试覆盖客户端 PCM 音频链路、VAD 分段、WebSocket 协议、乱序转写、翻译、尾段 flush、错误处理、存储、字幕窗、搜索、导出、重启恢复和最小窗口布局。端到端测试使用合成的麦克风/系统音频和本地 API，不消费真实额度。

**仍需实机验收**：真实 API Key 下的识别质量和延迟；macOS/Windows 实际麦克风与系统音频权限；Windows 程序启动与设备兼容性。当前开发环境是 macOS，不能据此宣称已在 Windows 实机验证。0.4.0 新增 64 段方案选择和 32 段独立验证，详见 `ASR-QUALITY-0.4.md`。0.3.0 曾用固定的 16 段 FLEURS 真人中文 / 日语录音对照旧版验证：中文字符错误率 42.5% → 5.0%，日语 51.4% → 10.7%。这是小样本朗读录音结果，不能代表会议场景或原版云端服务；完整方法见 `ASR-QUALITY.md`。Ollama 曾用合成英语转写实测通过；Codex 真实翻译已通过。当前机器的 Claude Code 返回 OAuth 401，需用户重新登录；不能宣称 Claude 云端调用已通过。未实现手机端和后台剪贴板管理。

## 参考协议

- [Soniox WebSocket API](https://docs.soniox.com/api-reference/stt/websocket-api)
- [Soniox 实时转写 token 语义](https://docs.soniox.com/stt/rt/real-time-transcription)

- [OpenAI Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription)
- [OpenAI Responses / text generation](https://developers.openai.com/api/docs/guides/text)
- [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
- [Claude Code headless](https://code.claude.com/docs/en/headless)
- [Transformers.js](https://huggingface.co/docs/transformers.js/)
- [Whisper Base ONNX model](https://huggingface.co/onnx-community/whisper-base)
- [Electron desktop audio capture](https://www.electronjs.org/docs/latest/api/desktop-capturer/)

## 代码结构

`electron/main.cjs` 管理窗口、权限、IPC 与会话生命周期；`realtime.cjs` 管理 OpenAI 兼容语音连接；`soniox.cjs` 管理 Soniox 流式修订、句末定稿与收尾；`local-speech.cjs` / `whisper-worker.cjs` 管理本地语音队列和独立识别进程；`providers.cjs` 管理引擎路由与文字任务；`vad-worker.cjs` / `speech-segments.cjs` 负责本地人声检测、预览和重叠分段；`model-assets.cjs` 下载并校验模型；`transcript-consensus.cjs` 保守合并三路声学转写；`speech-text.cjs` 处理明确的中文日期格式；`core.cjs` 包含云端音量门限、协议配置和导出；`store.cjs` 负责原子写入和密钥保存。`src/audio.ts` 与 `public/pcm-worklet.js` 采集、混音并输出 24 kHz PCM16；`src/` 其余文件构成 React 界面。默认启用 sandbox 和 context isolation，渲染器无 Node 权限，所有 IPC 校验发送窗口和页面。

本地识别运行时由 `scripts/build-asr.mjs` 打包，仅保留音频路径，图像处理不可用。ONNX Runtime 固定为 1.22.0 以保留官方 npm 包中的 Intel Mac 二进制，并修复了安装依赖中的已知 ZIP 漏洞。构建时需保留 `asarUnpack` 原生库配置。sherpa-onnx 及对应平台原生包固定为 2.0.1。模型不打入安装包，按需下载。
