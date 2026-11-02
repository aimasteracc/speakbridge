# SpeakBridge 0.7.8 議事録プロンプト・Markdown 表示の検証

日付：2026-11-02。

- 日本語の指定7項目・表・末尾メモを共通プロンプトに統合。資料の種類と網羅性を明示し、アプリの日時・タイトルや翻訳文を根拠として渡さない。中断・未確定・認識エラーを含む文字起こしは「一部」、正常終了でも網羅性は「不明」とする。
- 92件の自動テスト通過。追加8件は引用資料と指示の分離、メタデータの混入防止、部分資料・空入力・長さ制限、議事録専用の出力枠と翻訳への非波及、API / Ollama の明示的な打ち切り拒否、再生成失敗時の旧本文保持、Markdown の意味的描画と危険な HTML / URL / 画像の抑制を検証。
- CUA で実際の製品フロントエンドと隔離 Store / HistoryActions を操作。日本語見出し7項目、表3件、太字・入れ子リスト、末尾メモまでのスクロール、横はみ出しなし、旧形式の改行表示、新規生成、再生成のキャンセル・成功・失敗、再読み込み後の表示を確認。保存された Markdown が変わらないこと、失敗時の旧本文保持も隔離ファイルで確認。
- UI テストは公開固定資料と固定の生成応答を使用。外部モデルへ送信していない。これは実モデルの事実精度やプロンプト順守を保証する試験ではない。語音モデル・自動入力の再検証は範囲外。
- TypeScript と製品ビルド、敏感情報検査を通過。`npm audit --omit=dev` の指摘は0件（開発用依存関係はこの結果の対象外）。表示部品は [react-markdown](https://github.com/remarkjs/react-markdown) と [remark-gfm](https://github.com/remarkjs/remark-gfm) の公式仕様を参照し、HTML を無効化している。
- 初回パッケージ検査で npm 更新後に別アーキテクチャの音声部品が除去されていたことを検出。lockfile の SHA-512 と一致する公式レジストリの同一バージョンを復元して再パッケージした。
- 最終 Mac arm64 / x64・Windows x64 の3パッケージ各33ファイルの一致、必要なネイティブ部品のアーキテクチャ、Mac の厳格な再帰署名検査、ZIP 整合性を確認。チェックサムは `release/0.7.8/SHA256SUMS.txt`、詳細は `test-artifacts/package-0.7.8-verification.json`。
- 実行中の 0.7.7 に録音や未処理の听写結果がないことを確認して通常終了。同じ x64 系統の最終 Mac 0.7.8 を起動し、バージョンと議事録ページを画面で確認した。実際の会議データの生成・削除はしていない。Mac arm64 と Windows はパッケージ検査のみ。音声入力の権限状態は更新前から「待授权」であり、本輪でシステム設定は変更していない。
- 検証記録：`test-artifacts/notes-0.7.8-result.json`、`notes-0.7.8-unit.log`、`notes-0.7.8-build.log`。画面プレビューは固定テスト資料のみで、プロジェクト外に保存。

---

# SpeakBridge 0.7.7 全选与批量删除验证

日期：2026-11-02。按最新需求增加全选，取代 0.7.6 仅逐条删除的限制。

- 会话历史和会议纪要支持逐条勾选、全选当前搜索 / 收藏结果、半选状态、取消选择和批量删除。变更筛选会清空旧选择，变更勾选范围会重置删除确认；活动会话和无纪要的纪要行不可选。
- 84 项单元测试通过。新增 6 项覆盖显式 ID 范围、一次写入和通知、纪要删除保留原文、无效 / 重复 / 已删除 / 活动 ID 整批拒绝、写盘失败不部分删除且保留待处理任务、迟到的后台结果不恢复删除内容。
- CUA 操作生产前端 + 隔离 Store / HistoryActions：部分选择显示半选、全选与条数、改变范围重置确认、Escape 取消及焦点恢复、搜索与收藏筛选清空旧选择、只删除搜索命中记录、批量删除纪要、无纪要时禁用选择、批量删除全部会话、刷新后仍为空。
- 测试使用公开固定文本。直接核对隔离存储确认纪要清空后两条会话的转写和翻译完整保留；未删除用户真实记录，未录音、未调用外部 API。界面截图保存在项目外。fixture 并非原生 IPC 全链路测试。
- TypeScript、生产构建和敏感信息检查通过。Mac arm64 / x64、Windows x64 三包各 32 个应用文件匹配；原生架构、Mac 严格递归签名、ZIP 完整性通过。SHA-256 位于 `release/0.7.7/SHA256SUMS.txt`。
- 当前运行的 0.7.6 还有未填入的听写结果，因此保留旧版窗口，没有强制退出或启动新版覆盖它。0.7.7 可执行包已完成，尚未在真实用户配置下启动；Windows / Intel Mac 未实机运行。本轮未改动语音模型、快捷键或系统授权。
- 记录：`test-artifacts/history-0.7.7-result.json`、`history-0.7.7-unit.log`、`history-0.7.7-build.log`、`package-0.7.7-verification.json`。构建日志均已脱敏。

---

# SpeakBridge 0.7.6 逐条删除验证

日期：2026-11-02。

- 新增列表直接单条删除、独立删除纪要、清除当前听写结果；没有全选、多选、批量删除 API。删除需在原位置确认，Escape 或取消可返回，记录进行中不允许删除。
- 78 项单元测试通过。新增测试覆盖删除持久化、其他记录与原文保留、拒绝数组/空 ID、活动记录保护、写盘失败不丢内存内容、迟到的纪要/翻译成功和失败不回写、并行任务保留最新改名与收藏、输入事务中不能清除听写。
- 通过 CUA 操作实际生产前端和隔离 Store / HistoryActions 的本地浏览器 fixture：列表取消与删除、纪要列表和详情独立删除、原文与译文保留、Escape 焦点恢复、单次听写清除、筛选后删除只影响指定记录、最后一条删除及刷新后空列表。使用公开固定测试文本，没有录音或调用外部 API；fixture 不是原生 IPC 全链路测试。
- TypeScript 和生产构建通过。Mac arm64 / x64、Windows x64 三包共 32 个应用文件匹配、原生架构、Mac 严格递归签名、ZIP 完整性通过；SHA-256 在 `release/0.7.6/SHA256SUMS.txt`。
- 确认旧版空闲后正常退出并打开最终 Mac arm64 0.7.6，原生界面验证版本及会话历史逐条删除入口；没有点击用户真实记录的删除按钮。凭据文件状态与启动前一致。设置、历史和听写快捷键文件在现场观察期间发生变化，未认定原因、未回滚，也不声称其哈希不变；仅保留布尔检查，不保存真实历史正文或指纹。
- 语音输入页升级前后均显示「待授权」；本轮未重置或改动系统权限，也未重新验收语音输入。Windows / Intel Mac 未实机运行。
- 记录：`test-artifacts/history-0.7.6-result.json`、`history-unit.log`、`history-build.log`、`package-0.7.6-verification.json`。构建日志已脱敏；界面预览仅含固定测试数据，放在项目外。

---

# SpeakBridge 0.7.5 REA 对照改造与验证记录

> 隐私清理说明（2026-11-02）：以下为历史验证记录。其中的截图、原版原始证据、用户安装/配置指纹记录已移出项目，存放在仅当前用户可访问的本机备份；保留的构建与测试摘要已移除个人路径。旧证据路径仅说明当时的来源，不表示原始资料仍随项目提供。详见 [清理记录](PRIVACY-CLEANUP.md)。

日期：2026-11-02。原版安装包静态分析与实现决策见 [REA 对照报告](REA-DICTATION-0.7.5.md)。

- 实际运行 REA 6.8.0 对同一 Speakly 1.6.5200 ASAR 的 15 个指定文件分析，保留两份完整 Evidence bundle；覆盖快捷键、上下文抓取、窗口和结果交付。两份图覆盖均不完整，native 内部算法及当前远端应用规则仍未知，不把静态源码当成原版运行结果。
- 启动立即显示准备提示，目标探测与录音并行；最终交付等待本会话的探测。未知/密码/只读目标仍不自动写入，识别内容保留。写入一旦开始，取消和退出等待原生提交结束；不杀输入组件打断剪贴板恢复。输入组件故障也会撤销“输入就绪”显示。
- 68 项单元测试通过，其中新增 6 项实际主控制器 VM 测试覆盖慢探测、失败保留、取消后旧回复、提交中取消/退出、补填边界、helper 故障就绪状态；新增 3 项交付测试及 1 项原生策略测试（内部 14 个 Swift 断言）覆盖明确可编辑 group、只读/禁用/secure、嵌套焦点链。VM 和纯策略测试没有执行系统输入或使用真实麦克风。
- TypeScript、前端和 Mac 双架构原生构建通过；Mac arm64 / x64、Windows x64 三个包的 31 个应用文件匹配，Mac 递归严格 ad-hoc 签名、原生架构、ZIP 完整性与 SHA-256 校验通过。日志为 `test-artifacts/unit-0.7.5.log`、`build-0.7.5.log`、`package-0.7.5-verification.json`，校验值位于 `release/0.7.5/SHA256SUMS.txt`。
- 已正常退出空闲的 0.7.4，启动最终 0.7.5。用户完成 Touch ID 后，系统辅助功能开关为开，实际应用显示麦克风已允许、自动输入已就绪、模型已准备、快捷键已就绪。仅刷新声桥自身原有权限；原设置、会话历史、凭据文件状态未变，保留免持 `CommandOrControl+Shift+D` 与关闭按住模式。状态见 `test-artifacts/user-install-0.7.5-result.json`。
- 最终 0.7.5 Mac arm64 包通过 CUA 操作独立测试应用，使用「测试自动输入（不录音）」及真实鼠标点击悬浮条。NSTextView、WKWebView textarea、contenteditable 均收到完整固定文字「语音输入测试成功。Hello 123 👋」，各一次 input 事件；密码框拒绝且保持空白，结果保留；重新选中普通框的 Hello 后补填，只替换选中部分。各场景目标失去激活通知均为 0，四次成功写入后剪贴板内容/格式恢复，网页 Enter 均为 0。原始结果 `test-artifacts/input-0.7.5/mouse-*.json`，汇总 `result.json`。测试应用已退出。
- **真实麦克风＋全局快捷键完整链路仍未验收。** 固定中文 TTS 播放结束，但 CUA 发送 `super+shift+d` 及一次带按住时长的重试均未观察到录音启动或输出；不能据此区分工具按键投递与实际快捷键问题，不能认定识别器失败，也不能把固定文字写入当作听写成功。没有执行旧脚本的 CGEvent UI 驱动。当前 Codex 因工具明确禁止操作仍未验收；Windows / Intel Mac 没有实机运行。
- 没有更换 ASR 模型或调用付费 API，不声称识别率提高或超过原版。所有新增输入诊断不含目标正文、选中文字、标题、URL 或截图；听写依旧不保存历史。

---

# SpeakBridge 0.7.4 鼠标填入与焦点验证记录

日期：2026-11-02。实际运行平台：macOS / Apple Silicon。

- 用户点击“填入”后失败，界面提示前台应用为声桥或没有可输入的位置。0.7.3 使用普通 Electron 窗口加 `focusable: false`，只限制键盘窗口焦点，不能保证真实鼠标点击时不激活应用；此前的 AX 按钮操作没有覆盖这点。0.7.4 将 Mac 听写窗口改为 `type: panel` 的系统非激活面板，接受第一次鼠标点击，并跳过普通窗口的全屏工作区进程类型转换。依据：[Electron 文档](https://www.electronjs.org/docs/latest/api/base-window) 与 [45.2.1 NSPanel 实现](https://github.com/electron/electron/blob/v45.2.1/shell/browser/ui/cocoa/electron_ns_panel.mm)。
- 最终 0.7.4 Mac arm64 包在实际用户环境启动，麦克风/自动输入已允许、模型已准备、免持快捷键已就绪。按既有授权恢复当前包的辅助功能记录，没有变更其他应用权限。
- 这次通过 CUA 截图坐标点击悬浮条“填入”，不是 AXPress。连续向独立测试应用的 NSTextView、WKWebView textarea 和 contenteditable 填入「语音输入测试成功。Hello 123 👋」，实际文字完全一致，每个输入框各产生 1 次输入事件。密码框被拒绝且为空；点击“重新选择输入框”后，选中普通框内 Hello，再鼠标填入，只有选中文字被替换，前后内容保留，原生输入事件增加 1 次。
- 五个场景记录的目标应用激活状态均为 true，失去激活通知均为 0；四次成功填入后原剪贴板内容/格式恢复，网页 Enter 事件均为 0。原始结果位于 `test-artifacts/input-0.7.4/mouse-*.json`，汇总见 `test-artifacts/user-install-0.7.4-result.json`。测试应用只记录自身的公开固定测试句、事件计数和布尔状态，不读取其他输入框正文。
- 58 项单元测试、生产构建通过；Mac arm64/x64 与 Windows x64 三个包的 31 个应用文件匹配，Mac 递归严格 ad-hoc 签名及三个 ZIP 完整性验证通过，见 `test-artifacts/package-0.7.4-verification.json` 和 `release/0.7.4/SHA256SUMS.txt`。用户设置、历史和凭据文件状态不变；保留 `holdKey: off` / `CommandOrControl+Shift+D`。
- **当前 Codex 对话框尚未验收**：Computer Use 明确禁止操作 `com.openai.codex`，没有绕过限制，也没有宣称测试成功。本轮没有重新测试真实麦克风识别、Windows 或 Intel Mac 实机；没有调用付费 API。0.7.3 的结果不能视为鼠标点击焦点问题已经验证。

---

# SpeakBridge 0.7.3 自动输入验证记录

- 修复实际输入框定位：启用 Chromium 辅助功能树，查询系统、应用和窗口焦点；录音前捕获失败会中止，保留上一段结果。
- 开发中复现 WKWebView 的 `AXSelectedText` 返回成功但文本为空、input 事件为 0，已删除该写入路径。改用正常粘贴后，测试短句「语音输入测试成功。Hello 123 👋」实际进入 textarea，input 事件 1 次、Enter 0 次、原剪贴板恢复。测试由 CUA 操作独立本地应用；不是 Codex 实机验收。
- 连续输入暴露模拟 Command 状态残留，最终版本将粘贴 key-up 改为中性修饰键。系统身份验证完成后，恢复最终包既有授权，软件实际显示麦克风/自动输入已允许、模型已准备、快捷键已就绪。最终包连续向 NSTextView、WKWebView textarea 和 contenteditable 写入成功，中文/英文/emoji 完整，输入事件各 1 次，Enter 0 次，剪贴板内容/格式恢复。密码框拒绝且保持空白；保留文字可重新选框补填，仅替换选中的 Hello，前后内容保留。实际前台 Chrome contenteditable 也收到完整短句及 1 次 input 事件、Enter 0 次。结果与截图详见 `test-artifacts/input-0.7.3/`；安装状态详见 `test-artifacts/user-install-0.7.3-result.json`。
- 用户明确指出目标是当前 Codex 对话框。Computer Use 安全规则拒绝操作 `com.openai.codex`；没有改用其他途径绕过，也没有在用户对话框输入或发送测试文字。
- 58 项单元测试及生产构建通过；包括仅零写入失败允许补填、未知/部分写入不重试、未验证粘贴不误报成功、本地启动不触发钥匙串。3 个平台安装包的 31 个应用文件与当前源码匹配，Mac 两架构递归严格签名、ZIP 完整性、SHA-256 检查通过。见 `test-artifacts/package-0.7.3-verification.json` 与 `release/0.7.3/SHA256SUMS.txt`。
- 用户原设置、会话历史与密钥文件状态相对升级前未变，`holdKey: off` 与 `CommandOrControl+Shift+D` 保留。未记录用户听写正文。测试模式不调用麦克风、模型或 API；完整口述/全局快捷键、Codex、Windows 和 Intel Mac 本轮尚未实测。

# SpeakBridge 0.7.2 验证记录

日期：2026-11-02。修复 Mac 应用包签名，并在实际用户环境重新授权。

- 复现旧 0.7.1 包 `codesign --verify --deep --strict` 失败：`code has no resources but signature indicates they must be present`，签名标识仍为 `Electron`。旧配置 `mac.identity: null` 跳过重签名；TCC 日志也将进程识别为 Electron / 可执行文件路径。
- 新版改用 electron-builder 完整 ad-hoc 签名；Mac arm64 / x64 严格递归签名校验通过，签名标识为 `app.speakbridge.desktop`。回归证据：`test-artifacts/signature-regression-0.7.2.json`。这是本地试用签名，不是 Developer ID 或 Apple 公证，不能保证后续升级自动保留授权。
- 在用户明确允许重新授权后，先尝试重新开关与添加条目；仍未生效后，仅用 `tccutil reset Accessibility app.speakbridge.desktop` 重置声桥的旧辅助功能记录，再从系统设置添加准确的 0.7.2 路径。软件重新检查后实际显示「自动输入：已允许」「麦克风：已允许」「本地模型：已准备」「免持听写：快捷键已就绪」和「已准备好」。没有修改其他应用权限。
- 实际用户配置保留 `holdKey: off` / `CommandOrControl+Shift+D`。升级前未输入的听写结果已通过软件复制按钮保留；没有把听写内容写入测试报告。真实授权恢复已验证，但恢复后的完整口述到目标输入框尚未再次验证，不把之前隔离测试结果当作此次实机输入结果。见 `test-artifacts/user-install-0.7.2-result.json`。
- 56 项单元测试和生产构建通过；没有改动应用识别或输入逻辑。三个平台的 31 个应用文件与当前源码匹配；Mac 原生输入组件比较剥离签名并归一化签名引起的 `__LINKEDIT` 虚拟分配大小，其余字节全部比较。三个 ZIP 完整性与 SHA-256 通过：`test-artifacts/package-0.7.2-verification.json`、`release/0.7.2/SHA256SUMS.txt`。
- Windows / Intel Mac 未实机运行；没有调用付费 API。

---

# SpeakBridge 0.7.1 验证记录

日期：2026-11-02。修复 Mac Fn 默认键与权限就绪提示。

- 56 项单元测试通过。Mac 未保存配置时默认右 Option；明确保存的 Fn 选择仍保留。
- 4 组界面回归通过：缺权限先提示准备；免持键成功不冒充按住模式就绪；明确选择免持后独立判断；Fn 一键改为右 Option。结果 `test-artifacts/readiness-0.7.1/result.json`。
- 最终 Mac arm64 包通过 4 组权限恢复检查：父应用请求授权、输入组件一次刷新、持续拒绝的旧版本说明、录音中不刷新。采用隔离目录和权限返回值模拟，没有更改系统授权。结果 `test-artifacts/permission-0.7.1.json`，`packaged: true`。
- 最终 Mac arm64 包通过 20 组跨应用输入场景，本次使用真实右 Option 按下／松开事件，包含公开中文音频、焦点保护、取消和崩溃恢复。结果 `test-artifacts/dictation-0.7.1/result.json`，`packaged: true`。
- Mac arm64、Mac x64、Windows x64 的 31 个应用文件与工作区逐字节一致，原生组件架构、ZIP 完整性和 SHA-256 通过。Windows / Intel Mac 仍未实机验证。
- 已正常退出空闲的 0.7.0，并用界面核实实际用户环境启动了 0.7.1，首次启动默认键显示右 Option；用户随后说明键盘没有右 Option，已为实际用户单独保存 `holdKey: off`、`handsFreeShortcut: CommandOrControl+Shift+D` 并重启，在界面核实「免持听写」。常规设置、会话、凭据文件哈希不变。实际系统授权仍待确认，不能把隔离测试通过当作用户环境已经恢复输入。见 `test-artifacts/user-install-0.7.1-result.json`。

系统设置中的旧 SpeakBridge 开关曾显示打开，但旧程序仍报告输入未授权；这是一项运行时观察，不足以断言具体是签名变化、路径变化还是系统授权缓存。新流程从主应用请求权限，并对自有输入组件做一次刷新。没有关闭系统 Fn 功能或绕过系统授权。

---

# SpeakBridge 0.7.0 验证记录

验证日期：2026-11-02。实际平台：macOS / Apple Silicon。最终三个发布包已经重建并逐字节验证。

- `npm test`：56 项通过。新增各平台按住键／免持键校验，原生按键事件与请求回复交错传输；日志 `test-artifacts/unit-0.7.0.log`。
- `npm run build`：类型检查、前端生产构建、Mac 双架构原生组件、Windows 源码／二进制哈希检查通过。
- 原生键盘测试：Fn、右 Option、右 Ctrl 的按下／松开、重复按下过滤、清除输入目标后继续监听、关闭监听释放按键、无效键拒绝。结果 `test-artifacts/native-hold-0.7.0.json`。曾在原版正在运行时另行只读验证 Fn 返回冲突；没有修改或关闭原版。
- **最终 Mac arm64 包 20 组跨应用检查通过**：右 Ctrl 按住／松开、原页面不跳转、440 × 132 非激活提示及成功自动隐藏、关主窗后听写、模型启动期间音频缓存、松键即停麦、Esc 取消、麦克风准备中取消不弹窗、快捷键占用回滚、Unicode／emoji、不按 Enter、焦点／光标／密码框保护、剪贴板保持、复制、启动中取消、公开中文录音经真实 VAD／SenseVoice 输入、无 HTTP 和历史写入、渲染进程崩溃恢复、启动中正常退出。结果 `test-artifacts/dictation-0.7.0/result.json`（`packaged: true`）。
- 原有 **8 组 Electron 功能场景**与 **10 组字幕视觉场景**在最终 Mac 包通过，分别见 `test-artifacts/e2e-0.7.0.json`、`test-artifacts/visual-0.7.0/result.json`。后者 `packaged: true`。
- 额外后台生命周期检查：普通会议关窗先停止并保存，再隐藏到托盘；应用可以重新打开。结果 `test-artifacts/background-0.7.0.json`（`packaged: true`）。
- 三个平台的 `electron/` 与 `dist/` 文件、原生库和输入组件架构、三个 ZIP 完整性及 SHA-256 均通过，见 `test-artifacts/package-0.7.0-verification.json` 与 `release/0.7.0/SHA256SUMS.txt`。

测试使用隔离数据目录和独立输入应用；麦克风由合成 MediaStream 提供，另有一段公开中文录音。没有用用户会议或真实输入框测试，没有调用付费识别 API。未强制退出用户旧版应用；当前窗口仍有可复制的听写结果，用户数据保留原状。

Windows x64 与 Intel Mac 只完成编译和包验证，未实机运行。原版对照来自官方帮助和既有静态分析；没有同条件录屏延迟比较。本版改善操作与启动音频衔接，不宣称模型准确率提升。

---

# 0.6.0 跨应用听写验证（2026-11-02）

- 构建与 55 项逻辑测试通过。Mac arm64 / x64 Swift 输入组件编译通过；Windows net48 / x64 组件使用官方参考程序集交叉编译通过。
- Mac 独立目标应用测试通过真实快捷键、原生文字输入、同应用/跨应用焦点改变、选区改变、密码框、取消、模型启动时取消、纯标点、复制按钮和剪贴板不变检查。
- 公开中文录音通过实际 AudioWorklet、原生 VAD / SenseVoice 与系统输入，目标输入框等于定稿。没有真实麦克风采集、云端调用或听写历史保存。
- 最终 Mac arm64 安装包通过 12 组听写检查、原有 8 组 Electron 场景与 10 组字幕视觉检查；3 个平台的 30 个应用源码/前端/输入组件文件逐项匹配，语音原生库与输入组件架构、3 个 ZIP 完整性和 SHA-256 校验通过。
- 详细证据见 `test-artifacts/dictation-0.6.0/result.json` 与 [听写说明](DICTATION-0.6.md)。Windows / Intel Mac 输入尚未实机测试，不作全应用兼容保证。

# SpeakBridge 0.5.2 验证记录

验证日期：2026-11-01。实际运行平台：macOS / Apple Silicon。

- `npm run build` 通过，50 项单元测试通过。新增完整假设的纯标点过滤、短答 / 数字 / Unicode 保留、云端流式标点拼接、本地初稿撤回和逐字显示边界。
- 最终 Mac arm64 包通过 10 项视觉场景和原有 8 项桌面功能。一次输入批次产生 25 个不同可见状态，351 ms 内补齐；快速修订取消旧输出，定稿直接补齐，逐字换行不推走阅读位置。结果：`test-artifacts/visual-0.5.2/result.json`，日志：`visual-packaged-0.5.2.log` 与 `e2e-packaged-0.5.2.log`。
- 最终 Mac 包中，本地 fixture 的纯“。”片段及被撤回的初稿均不保存；普通句子含句号、小数原样保存。真实 SenseVoice + VAD 对既有公开中文录音原速运行，17 批 ASR 更新对应 88 次可见文字更新，首字约 1847 ms，定稿与 0.5.0 同一音频完全一致。报告：`test-artifacts/local-cleanup-0.5.2.json`。这不是模型原生流式或准确率提升的证明。
- 最终 Mac 包通过 Soniox 本机 WebSocket fixture，覆盖纯标点端点、初稿撤回、有效修订、最终文本和历史只保留正常段落。不连接真实 Soniox、不使用 API 额度。报告：`test-artifacts/soniox-e2e-0.5.2.json`。
- Mac arm64、Mac x64、Windows x64 的 24 个后端 / 前端文件与最终源码一致；原生库架构正确，3 个 ZIP 完整性与 SHA-256 通过。报告：`test-artifacts/package-0.5.2-verification.json`，校验值：`release/0.5.2/SHA256SUMS.txt`。
- 新版启用检查因已有应用 / 未结束会话而延期，没有结束用户进程或改动设置、凭据和历史。结束会话、退出旧版后打开 `release/0.5.2/mac-arm64/SpeakBridge.app`。记录：`test-artifacts/user-install-0.5.2-result.json`。

测试使用独立数据目录、公开录音与模拟服务。Windows / Intel Mac 尚未实机测试；没有原版同条件对照。纯标点规则也会省略有意单独口述、且被识别器转换成标点的片段。详细说明见 [连续出字与纯句号问题](STREAMING-DISPLAY-0.5.2.md)。

---

# SpeakBridge 0.5.1 验证记录

验证日期：2026-11-01。实际运行平台：macOS / Apple Silicon。

- `npm run build` 通过；`npm test` 45 项通过。
- 最终 Mac arm64 安装包通过 `tests/visual-flow.e2e.cjs` 的 8 项视觉场景：增量追加与中间修订、连续更新与 Unicode、定稿与单行译文的行高、跟随 / 暂停 / 恢复及上方译文的阅读锚点、900 × 650 窗口、悬浮字幕固定字号和长句收尾、减少动态效果、长历史滚动。没有页面错误。
- 最终 Mac 包通过原有 8 项 Electron 功能场景，以及 Soniox 本机 WebSocket fixture 完整修订 / 定稿 / 保存链路。测试目录隔离，不录制用户声音，不使用真实云端额度。日志分别在 `test-artifacts/visual-packaged-0.5.1.log`、`e2e-packaged-0.5.1.log`、`soniox-packaged-0.5.1.log`。
- 20 个后端文件与 0.5.0 发布 ASAR 逐字节一致；本版没有新的识别率或 ASR 延迟结论。记录见 `test-artifacts/backend-0.5.1-unchanged.json`。
- Mac arm64、Mac x64、Windows x64 三个平台的 24 个 `electron/` 和 `dist/` 文件均与最终源码一致；原生库架构正确、三个 ZIP 完整性通过，校验值见 `release/0.5.1/SHA256SUMS.txt`。
- 7 秒实际界面录屏在 `test-artifacts/visual-0.5.1/visual-demo.mp4`，使用预设演示文字，只展示视觉效果。
- 自动启用检查发现已有程序 / 未结束会话，保护性延期，未关闭用户进程、未改动设置或历史。退出旧程序后打开 `release/0.5.1/mac-arm64/SpeakBridge.app` 即可使用；检查记录在 `test-artifacts/user-install-0.5.1-result.json`。

Windows / Intel Mac 仅完成打包与包内容验证，尚未在对应硬件运行。没有原版同条件动画录像，不声称完全复现原版体验。具体显示策略见 [0.5.1 说明](VISUAL-0.5.1.md)。

---

# SpeakBridge 0.5.0 验证记录

验证日期：2026-11-01。实际运行平台：macOS / Apple Silicon，24 GB 内存。

- `npm test`：42 项通过；包括 Soniox token 修订与确认、鉴权失败、断线与停止收尾、加密密钥隔离、本地最新预览合并、迟到初稿保护、复核期间识别下一句，以及错误时初稿保留。
- `npm run build`：类型检查与生产构建通过。原有 8 项 Electron 场景通过，日志 `test-artifacts/e2e-0.5.0.log`。
- `tests/soniox.e2e.cjs` 在最终 Mac arm64 包中通过：UI 保存独立密钥、实际系统加密、同一行逐步修订、空文本 EOF 后接收定稿、保存历史和删除密钥。仅连接本机 WebSocket 模拟服务，真实 Soniox 云端未验证、未消费 API 额度。
- 0.4.0 / 0.5.0 本地原速音频对照：两段中日语录音 × 两种模式 × 每种两次重复。中文首次出字约 5.1 → 1.9 秒，日语约 7.8 → 4.6 秒；日语包含较长前导静音。文字变化间隔约 4.0 → 0.8 秒。8 对最终转写一致。详见 [延迟与限制](STREAMING-0.5.md)。
- 32 段独立中日语录音分别运行 SenseVoice 与增强模式，两个模式的最终文字均与 0.4.0 逐条一致；结果见 `test-artifacts/accuracy-regression-0.5.0.json`。
- 三个平台的 `electron/` 和 `dist/` 共 24 个文件与源码逐字节一致，原生库架构匹配，三个 ZIP 完整性与 SHA-256 已核验。详见 `test-artifacts/package-0.5.0-verification.json` 与 `release/0.5.0/SHA256SUMS.txt`。
- 最终 Mac arm64 包真实三模型测试通过，首次字幕 3041 ms，录音到定稿 23333 ms；覆盖词典传递、静音、语言校验与保存。外文人名提示仍未正确识别，未宣称提示必然生效。
- 已在真实用户环境打开 0.5.0，保留原有 SenseVoice 设置。启动前无活动应用 / 录音，未关闭用户进程；设置、11 条会话及凭据文件哈希保持一致。记录在 `test-artifacts/user-install-0.5.0-result.json`。
- Soniox 必须主动选择并提供独立 Key；本地识别仍无 API 费用。翻译继续使用配置的文字服务，可能消耗账户额度。

本次没有原版同音频输出，不能宣称超过原版。没有自动采集用户麦克风或系统音频；Windows / Intel Mac 实际硬件、真实会议噪声及 Soniox 云端延迟仍未验证。

---

# SpeakBridge 0.4.0 验证记录

验证日期：2026-11-01。实际运行平台：macOS / Apple Silicon，24 GB 内存。

- `npm test`：30 项通过。新增三路转写保守合并、词语原子性、空白/发散回退、模型清单与词典限制、中文日期格式、完整停顿分段测试。
- `npm run build`：类型检查与生产构建通过。原有 8 项 Electron 界面、音频链路、翻译、历史和导出场景通过，日志 `test-artifacts/e2e-0.4.0.log`。
- 新增 64 段方案选择与 32 段独立验证，并对独立集添加固定 10 dB 白噪声。完整方法、逐条改善与退步、限制见 [识别报告](ASR-QUALITY-0.4.md)。独立集的原始及加噪声基线均用实际 0.3.0 ASAR 和原生库复核，字符错误数一致。
- `tests/precision.e2e.cjs` 实际启动最终 0.4.0 Apple Silicon 包，使用 `--user-data-dir` 隔离目录并断言路径，经过真实 ASAR 中的三模型推理、VAD、IPC、预览与保存流程。15.42 秒中文公开录音按原速注入，预览约 6.3 秒出现，录音开始到定稿约 23.3 秒（包含约 15.4 秒播放等待；不含模型启动与翻译）。此为单个本机样本，不能作为其他设备延迟保证。
- 安装包验证了 Qwen 词典参数传递、超长词典与不支持语言在开始前拒绝、三模型静音不产出文字、模型选项保存。一个外文人名虽收到词典仍识别错误，已明确记录，不将词典测试当成准确率通过证明。
- 三个平台的 `electron/` 和 `dist/` 23 个文件逐字节与源码一致；包内 sherpa 原生版本均为 2.0.1，格式分别为 arm64、x86_64 Mach-O 和 x64 PE。三个 ZIP 完整性通过，SHA-256 见 `release/0.4.0/SHA256SUMS.txt`。
- 新模型已复制到本机应用模型目录并完成 SHA-256 校验，可离线加载。此次未完整走应用内下载 3.7 GB 的网络流程；已分别获取并验证固定上游文件。Whisper Turbo 从 sherpa 官方发布归档取得，文件哈希与清单固定的 Hugging Face 文件一致。
- 新版没有改动云端翻译路由、密钥格式或会话存储格式。测试使用隔离目录和公开录音，不将合成测试会话写入用户历史。
- 交付时检测到用户正在旧版录音，因此未关闭旧版、未修改当前模型选择。增强模型已经在真实用户目录准备好；结束录音并退出旧版后，打开 0.4.0，在设置选择“增强识别”并保存即可启用。切换前再次检测到用户开始新录音，激活脚本保护性退出，未修改进程或设置。

尚未验证 Windows / Intel Mac 的实际运行和麦克风权限；未测原版同音频识别率、远场真实会议或多人重叠。安装包未签名 / 公证。新增模式的资源和效果限制已在设置页及 README 说明。

---

# SpeakBridge 0.3.0 验证记录

验证日期：2026-11-01。当前平台：macOS / Apple Silicon，24 GB 内存。

## 本次修复已通过

- 默认 SenseVoice Small int8 + Silero 人声检测；保留 Whisper Base 兼容模式。模型、VAD 与识别运行库从公开上游获取，没有调用原版私有接口。
- `npm test`：23 项通过，包含长句不再 8 秒硬切、声学重叠无丢样本、传递缓冲区后仍能续接、字幕预览标识、重复文字处理、模型损坏及设置迁移校验。原云端分段逻辑的测试也继续通过。
- `npm run build`：类型检查与生产构建通过。
- 8 个原有 Electron 场景通过；3 个本地引擎 / Harness 场景通过。DeepSeek Harness 原有配置和路径保持兼容。
- `node tests/asr-quality.cjs`：16 段固定 FLEURS 真人录音的完整旧 / 新流程对照通过。中文 CER 42.52% → 4.98%；日语 51.37% → 10.66%。静音与白噪声不生成文本。方法、数据版本和限制见 `ASR-QUALITY.md`。
- `node tests/asr-live.e2e.cjs`：真实中文长句按原速送入 Electron，约 6.41 秒出现可修订预览，结束后保存完整定稿；模型切换保存、未安装模型状态和不支持的源语言提示均通过。
- `node tests/packaged-smoke.cjs`：最终 0.3.0 Apple Silicon 包实际启动；从 ASAR 运行独立 VAD / SenseVoice 进程完成语音转写，再切换到 Whisper 推理成功。用户数据目录中的新模型已安装，默认选择 SenseVoice。
- 真实模型下载器完成联网下载、SHA-256 校验、原子安装及离线复查。
- `npm audit --omit=dev`：运行时依赖 0 条已知安全公告；开发依赖另有公告，未以破坏性自动升级处理。
- macOS arm64 / x64 与 Windows x64 的包内代码与当前源码逐文件一致，均包含对应平台的 sherpa 原生库；Intel 库为 Mach-O x86_64，Windows 库为 PE x86-64。各 ZIP 完整性检查通过，已生成 SHA-256。

产物在 `release/0.3.0/`。截图、逐条识别结果和检查记录在 `test-artifacts/`。旧版包保留，未修改 API 密钥或会话内容。

## 验证边界

真实本地推理已测，但未自动录制用户麦克风，也未直接比较原版云端服务。16 段是小规模朗读样本，不代表所有噪声、口音或会议场景。Windows 和 Intel Mac 已构建并核对依赖，尚未在对应硬件上运行。安装包仍未签名 / 公证。个人词典尚未接入本地声学识别，不把 LLM 猜测当作听写纠错。

---

# SpeakBridge 0.2.1 历史验证记录

验证日期：2026-11-01。开发与桌面测试平台：macOS 26.6.2 / Apple Silicon。

## 已通过

- `npm run build`：TypeScript 检查、Vite 生产构建。
- `npm test`：16 项测试全部通过。
  - 静音过滤、预缓冲、停顿分段、最后一句提交。
  - 连续发言按 8 秒分段且 PCM 样本不丢失。
  - 服务地址与配置校验。
  - 流式转写协议配置。
  - 双语 SRT 顺序与时间戳。
  - 密钥存储、重启恢复、损坏数据文件保留。
  - 真实本地 WebSocket 的乱序转写、翻译与结束时排空。
  - 语音模型配置错误、翻译认证错误。
- `npm run test:e2e`：8 个 Electron 端到端场景全部通过，无页面脚本异常。
  - 初始布局与渲染进程隔离。
  - 双语演示与原生置顶字幕窗口。
  - 搜索、改名、剪贴板与 SRT 文件导出。
  - 加密密钥、配置持久化与服务连通性测试。
  - 合成麦克风和系统音频 → AudioWorklet → IPC → WebSocket → 翻译 → 本地保存。
  - 基于转写生成纪要。
  - 录音权限拒绝后不启动云端会话。
  - 重启保留会话、收藏、词典、纪要与密钥。
  - 900 × 650 最小窗口下所有导航可达，无横向溢出。
- `node tests/packaged-smoke.cjs`：打包后的 Apple Silicon 应用启动成功，加载 app.asar 中的界面资源，IPC 正常；打包内的原生 Whisper 已完成合成语音推理。
- `npm audit --omit=dev`：运行时依赖 0 条已知安全公告。
- 构建产物：macOS arm64 / x64，Windows x64；均未签名。

截图与机器可读结果在 `test-artifacts/`。合成测试 API Key 为本地固定测试字符串，测试目录结束时自动删除，不会进入发布包。

## 新增本地引擎验证

- `tests/providers.test.cjs`：自动路由、显式选择、缺少密钥/CLI、CLI 工具限制、Harness stdin、超时/取消、Ollama 错误、重采样与尾段排空。
- `node tests/local.e2e.cjs`：3 个场景，DeepSeek Harness 专用设置持久化；设置保存无 API Key；真实 Electron Worker 中 Whisper → Harness → 本地双语记录。模型和合成语音置于 test-artifacts。
- Whisper 离线识别：5.57 秒系统合成英语语音；在禁止网络的执行环境加载 1.28 秒，推理 0.36 秒，正确识别 Windows / Mac 句子。仅为本机样本，不能代表所有设备和语言。
- Ollama `qwen3.5:2b`：上述转写翻译为中文，约 3.60 秒。
- Codex 0.153.4：现有账户登录的真实单句翻译成功，约 6.23 秒。
- Claude Code 2.1.183：调用启动正常，远端返回 401 OAuth access token invalid；需要用户重新登录，未计入真实服务成功。
- 自定义 Harness 测试使用确定性的测试适配器，不代表未知第三方 Harness 已验证。

## 真实环境仍需验收

- 没有提供真实 API Key，因此尚未验证云端账户权限、真实语音准确率、语言切换质量、费用和延迟。接口遵循当前官方文档，但模拟 API 通过不等价于真实服务通过。
- 没有自动采集用户的真实麦克风或系统音频；macOS 权限弹窗、CoreAudio Tap、设备切换仍需用户实测。
- Windows 包已构建并核对 PE x64 文件格式，未在 Windows 实机运行；Intel Mac 包也未在 Intel 实机运行。
- 开发者证书签名、公证、商店上架、自动更新、手机端和系统剪贴板监控不在本次实现范围。

## 建议验收步骤

1. 启动对应平台的程序，先运行演示并打开字幕，确认能置顶在会议软件之上。
2. 填写 API Key，保存并测试连接。
3. 分别测试麦克风、系统声音、混合声音；推荐佩戴耳机，避免同一句声音被重复采集。
4. 说出含专业术语和数字的中、日、英文句子，观察实时文本和最终翻译。
5. 在句子结束前立刻按“结束”，检查尾段被保存；结束后导出字幕并重新打开应用检查历史。
6. 关闭网络、取消系统权限和断开输入设备，确认出现提示而不是伪装成功。

## DeepSeek Harness 0.2.1 适配

- 找到本机 npx 缓存中的官方 dsh 0.1.5-rc.1。
- 新增 2 项单元测试：发现/路由/路径校验；长文本补丁、临时 Home、工具守卫。
- `node tests/deepseek.integration.cjs`：真实 dsh CLI 连接本机模拟 DeepSeek SSE 服务；无模型工具、仅最终译文、402 配额错误中文提示、原用户历史不写入均通过。
- 真实服务返回 QUOTA / Insufficient Balance，未宣称真实 DeepSeek 翻译成功，未充值或改变模型服务。
- UI 新增专用 DeepSeek Harness 选项与配置目录，独立于自定义适配器；显式选择覆盖自动路由，自动模式保留已有 Codex / Claude 顺序。
