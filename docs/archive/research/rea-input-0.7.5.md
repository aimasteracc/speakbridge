> 历史归档：保留当时的结论，不代表当前版本或服务状态。现行用法见[文档索引](../../README.md)，验收边界见[验证状态](../../verification.md)。文中测试产物路径相对于项目根目录；未纳入 Git 的本机证据不随源码提供。

# 原版听写流程对照与声桥改造

日期：2026-11-02。目标：从快捷键开始，到识别结束后文字自动进入原输入框；补填只用于失败恢复。

隐私清理说明：本报告保留技术观察和证据编号；下文引用的原始 Evidence bundle、原版代码副本和本机路径记录已移入本机私有备份，不再包含在项目中。详见 [清理记录](../reports/privacy-cleanup-2026-11-02.md)。

## 分析身份和范围

本次实际运行本机 REA 6.8.0 CLI，对 `/Applications/Genspark Speakly.app/Contents/Resources/app.asar` 的 15 个指定文件分两组分析。安装包版本 1.6.5200，SHA-256 为 `fa341adaa9dfc5102d3bc3a950c06034a7c353548f6d833434d403011009e885`，与之前证据相同。本次扩充了此前未覆盖的输入策略、悬浮窗口和结果交付模块。

- 窗口、上下文、原生桥及快捷键：`ev_46309f9438febabd374b20dc2ee2f8c9feb5d8b5a6e9152901531f9ce2851818`。
- 听写编排、输入回调和失败弹窗：`ev_1d3f5f08de3afe1aa8f316d2845a08043cd79a5c2edb24be41e90b7e587c1f7c`。
- 完整 Evidence bundle、摘要及只读分析副本：`test-artifacts/original-input-analysis/`。

这是安装包静态分析，没有启动原版、请求其服务、读取其账户或用户配置。两个应用图均为 partial：文件选择之外的关系未知，语义未知记录达到上限。四个打包的 sherpa/onnx 原生文件与 ASAR 声明哈希不一致，按 REA 的 `record-and-continue` 保留为 observed-untrusted；本报告不对这些二进制作行为结论。

## 问题与证据

以下路径相对于分析副本的 `source/dist/src/`，行号是原样提取文件中的位置。

| 问题 | 静态观察 | 结论范围 |
| --- | --- | --- |
| 开始时是否等待输入框检测？ | `services/VoiceModeService.js:1409` 发出 opening，1426 启动麦克风，1466 创建识别会话；`VoiceRecognitionService.js:782` 后台抓上下文。`ContextService.js:62` 光标查询超时返回 null，`VoiceRecognitionService.js:876` 无上下文继续。 | 识别与上下文检测分离；注释中的耗时不是实测。 |
| 正常结束要点“填入”吗？ | `VoiceModeService.js:2818` 处理 Computer/insert 动作，2854 调用输入回调；`main/index.js:3508` 接到 `NativeService.insertText`。本地定稿在 `VoiceRecognitionService.js:1267` 构造 insert 动作。 | 客户端存在自动交付流程，补填不是正常必经步骤；云端动作发出的时机仍未知。 |
| isEditable=false 就拒绝吗？ | `VoiceModeService.js:2835` 记录 isEditable/hasCursor，但不据此跳过原生输入调用。 | JS 不将上下文完整性当作硬门槛；原生组件如何校验目标未被反编译。不能照此无条件粘贴。 |
| 怎样保持焦点？ | `main/RecordingTipWindow.js:643` 不设父窗口；657–693 使用非聚焦 panel、跨工作区且跳过进程转换；719 还调用自有 panel addon；828 使用 showInactive。 | 原版有专门的原生窗口处理。没有运行其 addon，不能仅凭调用声称掌握所有平台行为。 |
| 使用哪种写入方式？ | `TextOperationStrategy.js:45` 冷启动默认 clipboard、select none、verify auto；远端可提供分层应用规则。`NativeService.js:747` 将 text/sessionId 交给 native。 | 默认声明可见；没有读取远端规则或 native 内部实现，不知道 Codex 特定策略。 |
| 失败如何处理？ | `VoiceModeService.js:2859` 处理原生 1001 焦点变化；2862、2873、2885 等分支显示结果弹窗。 | 保存结果供恢复，不证明能自动恢复任何第三方焦点。 |

## 声桥的独立实现决策

1. 快捷键开始立即显示准备反馈。输入目标探测与音频启动并行；探测失败仍保留本次可用转写。最终交付必须等待同一次探测，未确认目标时不自动粘贴。
2. 只对明确声明 `AXEditable=true` 的 AXGroup/AXUnknown 增加兼容；保留标准文本角色，同时拒绝明确只读、禁用和 secure 控件。此为声桥的保守策略，不宣称复现了原版 native 算法。
3. 写入开始后作为一个短暂的不可取消阶段：等待原生组件完成粘贴、恢复剪贴板并回报。识别和定稿仍可取消；不能用杀死输入组件代替取消，否则可能留下临时剪贴板。
4. 失败诊断只包含阶段、结果代码、控件角色及能力布尔值；不查询目标正文、选中文字、窗口标题、URL 或截图，不保存听写历史。诊断在失败结果里按需展开。
5. 保留“已发出粘贴但未验证”和“已验证输入”的区别。不复制原版默认的 `verifyFallback: success`，不自动重试可能已经写入的文本。

没有更换识别模型、自动启用云端或扩大会议内容收集。本地/API 的产品选择需要单独设计，不能顺带改变当前听写的隐私边界。

## 尚未回答

- 原版 native 的目标快照、选区处理、应用兼容规则及验证算法：未取得足够证据。
- 当前 Codex 对话框实际可用性：桌面工具明确禁止操作 `com.openai.codex`，不能绕过，也不能用独立输入框测试代替此项验收。
- Windows / Intel Mac 的桌面行为、原版与声桥同音频延迟和准确率：本轮静态分析不能回答。

本次实现和测试结果另见 `docs/archive/reports/qa-history.md`；本报告只区分原版观察、独立设计和未知，不把计划当验证结论。
