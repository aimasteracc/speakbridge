> 历史归档：保留当时的结论，不代表当前版本或服务状态。现行用法见[文档索引](../../README.md)，验收边界见[验证状态](../../verification.md)。文中测试产物路径相对于项目根目录；未纳入 Git 的本机证据不随源码提供。

# 语音识别准确率差异调查

补充：后续查到 Genspark 与 Soniox 的官方供应商合作公告，并进一步核对了临时文本修订机制。见 [流式识别调查](speakly-streaming.md)。以下保留对 0.2.1 的历史诊断，不能作为当前状态说明。0.5.0 的实现与速度实测见 [流式优化报告](../releases/0.5.0-streaming.md)。

日期：2026-11-01。对象：当前 SpeakBridge 0.2.1 与本机已安装的 Genspark Speakly（包内版本 1.6.5200）。本次只做诊断，没有改动识别参数、用户设置或原版程序，也没有采集新的麦克风录音。

## 结论

此前实现的是截图所示功能的独立重建，没有复现原版服务端识别引擎。当前本地链路使用单一 Whisper Base q8，音频分段和上下文处理较简单。它能运行，并不代表已经达到原版的中文识别准确率。之前的功能测试及单条合成英语识别测试不足以验证这一点。

已确认的模型和分段差异，是优先排查和改进的对象；尚无同一录音的对照结果，不能给每项原因分配准确率损失，也不能断言换某个模型就一定追平原版。

## 当前程序的实际状态

- 最近三次非演示会话都记录为 `speech: local`、`text: codex`。语音实际进入 Whisper；Codex 只接收识别后的文字。
- 当前设置已指定中文 `sourceLanguage: zh`、麦克风输入、700 毫秒静音切分、0.012 音量阈值。因此不能将此次问题简单归咎于未指定中文或麦克风与系统声音混音。
- `scripts/asr-entry.mjs:8` 固定加载 `onnx-community/whisper-base`，q8、CPU。`scripts/asr-entry.mjs:15` 每段单独解码，没有传入上一段文本或词典提示。
- `electron/core.cjs:65` 的 VoiceGate 根据音量判断是否有语音；在静音达到阈值或片段满 8 秒时提交。强制切分后没有重叠音频，也没有检查是否切在词中间。背景噪音和句中停顿可能影响切分，具体影响尚未量化。
- 一个近期会话共有 28 段，其中 11 段恰好 8 秒、6 段不足 2 秒。另一次 43 段中有 18 段恰好 8 秒。这证实强制切分经常触发，但这些统计本身不是识别错误率。
- `electron/local-speech.cjs:89` 先完成转写，再在第 93 行调用文本翻译。更换 DeepSeek Harness、Claude Code 或 Codex 不会改变前面的听音识别模型。

只保留统计的证据：`test-artifacts/original-analysis/current-session-metadata.json`。报告未复制用户转写内容。

## 原版安装包中观察到的实现

下述原版路径均相对于 `test-artifacts/original-analysis/source/`。源码是从安装包按路径提取的只读副本，没有执行其中代码。

- `dist/src/services/Meeting/TranscriptionManager.js:145` 的转写入口创建 TranscriptionSessionFlow；同一入口处理 `live_transcript` 分类。发送配置含语言提示、音轨及服务端协议能力。
- `dist/src/services/flow/transcript/TranscriptionSessionFlow.js:198` 及 `_dispatchAudio` 持续转发音频；接收 `transcript_delta` 和 `transcript_final`。这支持“原版具有服务端流式转写链路”的判断。未调用其私有接口，未确认用户当时实际连接的服务器模型。
- `transcript_update` 在此版本处理的是翻译更新，不能据此声称原版具有转写文本二次纠错。
- `dist/src/services/BuiltinComponents.js:21` 声明了本地识别选项，包括 SenseVoice、Whisper Base/Small/Large v3/Turbo、Qwen3-ASR、Paraformer、Dolphin、Parakeet。
- `dist/src/worker/localSttWorkerCore.js:27` 具有相应引擎配置分支，经 sherpa-onnx OfflineRecognizer 执行。模型出现在目录中不等于用户已下载或实际使用，也不意味着截图中的实时转写页面使用这些本地模型。

## REA 证据与限制

- 工具：`rea-agents@6.8.0`。分析原始 ASAR 中 4 个明确选择的 JavaScript 文件；4 个解析成功，未执行原版代码。其余提取文件的补充观察来自普通源码阅读，不冒充 REA 已覆盖的文件。
- 原始 ASAR SHA-256：`fa341adaa9dfc5102d3bc3a950c06034a7c353548f6d833434d403011009e885`。
- REA 完整父证据 ID：`ev_655e9d1830f94fa678c517ed2fd9b637ba15a8270afa13324bc24c4227dd122a`。
- 摘要：`test-artifacts/original-analysis/rea-summary-recorded.json`。
- 完整证据：`test-artifacts/original-analysis/rea-evidence.json.gz`（压缩保存）。
- 首次分析因 ASAR 声明哈希与原生库文件不符而终止。随后采用 `record-and-continue` 保留差异；共记录 4 个 sherpa/ONNX 原生文件哈希差异。原因未核实，不将其归因为软件被篡改，也不据此判断识别效果。
- 只分析选定文件，应用及语义图覆盖为 partial；语义 unknown 记录达到工具上限。没有检查整个 413 MB 证据中的每个节点，摘要和所引源代码足以支持上述有限观察，不能用于推断完整运行行为。
- 本机 Node 24.14.0 低于该版 REA 声明的支持版本；CLI 发出兼容性警告，但本次完成分析并返回证据。该结果不构成对 REA 工具运行环境兼容性的全面验证。
- 原版用户配置不是可直接解析的 JSON，本次没有解密或修改它，也没有读取登录凭据。因此原版用户实际启用的识别模式仍未确认。

## 改进顺序与验收

1. 为本地识别提供适合目标语言的质量选项；以中文/日语实际录音对比 SenseVoice、Paraformer、较大 Whisper 等候选。模型名称或体积不能替代测试，需同时测延迟和设备负载。
2. 使用更可靠的语音活动检测；按语音边界切分，对必须强制切分的长句保留重叠并正确去重。补上上下文和术语支持，避免把这些功能仅接到翻译层。
3. 使用同一批经过授权的录音、人工参考文本及相同音源比较原版和重建版；中文/日语统计字符错误率，另测首字延迟、最终文本延迟、噪声和长句表现。
4. 有公开语音识别 API 时可评估云端质量，但目前没有证据表明现有 API 配置等同于原版后端。REA 能帮助分析客户端，不会自动取得服务端模型。

SpeakBridge 当前不保存原始音频，不能用已有会话文本重建公平的音频对照试验。本次没有修改程序、下载更大模型或宣称准确率已提高。

参考：OpenAI Whisper 官方说明将不同模型规模描述为速度与准确率之间的取舍，Base 为 74M 参数，并说明识别表现随语言变化。https://github.com/openai/whisper#available-models-and-languages
