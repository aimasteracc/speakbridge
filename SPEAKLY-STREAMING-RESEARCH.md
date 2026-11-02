# Genspark Speakly：流式识别与动态修订调查

调查日期：2026-11-01。对象是截图和此前本机安装包对应的 **Genspark Speakly（speakly.ai）**，不是 tryspeakly.com、语言学习应用或其他同名产品。本轮查阅公开网络资料并复用先前提取的只读客户端源码；没有调用原版私有服务、读取登录凭据、录制用户声音或改变运行中的软件。

## 新确认的供应商信息

Genspark 与 Soniox 的官方 LinkedIn 账号均宣布，Genspark 选择 Soniox 作为语音转写供应商，覆盖其语音交互、会议记录等场景。这比此前“服务端模型未知”的判断多了一条直接的公开证据。公告没有列出 Speakly 各功能、账户、语言的具体路由或模型版本，不能据此断言每次实时翻译会话都固定使用 Soniox。

- [Genspark 官方公告](https://www.linkedin.com/posts/gensparkai_ai-speechtotext-voiceai-activity-7510730885147844609-IYjG)
- [Soniox 官方公告](https://www.linkedin.com/posts/soniox_ai-speechtotext-voiceai-activity-7510729861515337728-QFH0)

先前提取的 `flow/stt/sttDebugConfig.js:21` 也列出 `soniox`，同时还有 OpenAI、BytePlus、AssemblyAI、Deepgram 等调试选项。`SttSession.js:88` 表明一般路径省略供应商覆盖，由服务器选择。这个列表能佐证多供应商适配能力，不能证明默认供应商、实际选择或用户可以自由开启调试选项。

## 为什么文字出现后还会变化

[Soniox 实时转写文档](https://docs.soniox.com/stt/rt/real-time-transcription)说明，音频通过 WebSocket 连续传入，服务返回临时与确认的文本 token。`is_final: false` 的临时部分可随更多音频而被替换或撤回；`is_final: true` 的确认部分不再由该 ASR 协议修订。界面需要保留确认前缀，替换最新的临时尾部，不能把每次临时结果都累加成新文字。

这类声学解码修订本身就能产生“边说边改字”的效果，不必每次再调用文字大模型。结合供应商公告与客户端事件处理，它是解释用户观察到的行为的有力线索；本轮没有观测原版某次实际网络会话，仍属于机制解释而非运行路径证明。

客户端证据（安装包 1.6.5200 的只读副本，根目录为 `test-artifacts/original-analysis/source/dist/src/`）：

| 已观察到的代码 | 能支持的判断 | 不能推断的内容 |
| --- | --- | --- |
| `services/flow/transcript/TranscriptionSessionFlow.js:198` 持续派发音频块 | 客户端有持续上传音频的链路 | 每个音频块都立即对应一条字幕 |
| 同文件 `:498` 区分 `transcript_delta`、`transcript_final` | 协议区分临时转写与定稿 | 服务端模型架构及精确版本 |
| 同文件 `:557` 将 `m_openDeltaText = text`，再转发 Delta | 当前临时文本可被整份新结果替换 | 所有已定稿原文都会持续回改 |
| 同文件 `:642` 的 Update 接收 `translation` | 本版 `transcript_update` 用于译文更新 | 不能把事件名字解释成原文二次纠错 |
| `services/Meeting/TranscriptionManager.js:145` 创建 TranscriptionSessionFlow，处理 live_transcript | 会议和实时转写入口接入该流程 | 用户当时选择的服务器引擎 |
| `services/MicNativeService.js:65` 配置 24 kHz、60 ms 编码帧、每回调 2 帧 | 原生麦克风配置有约 120 ms 音频交付节奏 | 120 ms 不是首字或定稿延迟实测值 |

[Soniox 端点检测文档](https://docs.soniox.com/stt/rt/endpoint-detection)另说明，它可以结合停顿、语调与上下文判断话语结束。更早定稿能降低延迟，也会减少可用于修订的上下文。该能力属于供应商文档，尚未确认 Speakly 的开启状态和参数。

## 声学修订、文字润色、翻译更新要分开

[Speakly 官方帮助](https://www.genspark.ai/helpcenter/speakly)公开说明 AI 后处理可清理口头填充词、整理句子和标点，也提示专名、习语可能被过度修改。这是语音输入产品的文字整理能力，不能直接证明截图中的实时转写页面每一轮临时更新都经过相同的润色步骤。

因此应区分三件事：

1. ASR 随着后续音频修改尚未确认的识别结果。
2. 文字模型对转写作措辞、格式或口误整理。
3. 翻译随着原文及上下文变更而更新。

官网当前说明依赖云端语音识别与文字整理；已提取客户端同时存在本地模型清单。两者不能简单互相否定：包里有模型配置不等于该功能已经对所有用户开放，更不代表实时翻译页面采用这些模型。

## 与 SpeakBridge 0.4.0 的实际差别

我们的本地链路使用离线识别器，对积累中的语音窗口重复解码。`electron/speech-segments.cjs:30` 将预览间隔设为约 4 秒；`electron/local-speech.cjs` 用相同段 ID 更新临时文本，所以已有“修改当前句子”的基础能力，但频率低，解码不是原生增量流式模型。

增强模式的 `electron/whisper-worker.cjs:37` 先用 SenseVoice 出预览，最终依次调用 Qwen3-ASR 与 Whisper Turbo 再合并。它改善了小样本定稿错误率，却增加了最终结果等待时间。实际安装包的 15.42 秒中文样本约 6.32 秒出现首条预览，约 23.27 秒得到最终结果（包含播放等待，不含模型启动和翻译）；这些数值只属于该样本，不能当作原版对照。

上一轮改造主要优化定稿准确率，未充分对齐原版的即时反馈体验。后续技术方向应调整为：

- 正式流式 ASR 持续产出临时结果；若接 Soniox，应实现其公开协议与独立凭证，不把现有 OpenAI 兼容地址简单替换过去。公开协议见 [WebSocket API](https://docs.soniox.com/api-reference/stt/websocket-api)。
- 显示层维护“已确认文本 + 可修订尾部”，让用户立即看到新文字，旧响应不能覆盖新段落。
- 三模型复核适合作为可选的定稿质量模式，不宜让实时字幕等待三路串行推理。
- 保留本地离线路线，但低延迟模式需要单独评估流式模型或更短的自适应窗口，不能只把定时器从 4 秒缩短就宣称质量不变。
- 验收同时统计首字延迟、连续更新间隔、停说到定稿延迟、修订次数和 CER；必须同录音、同语言、同音源比较。

以上为研究结论和后续设计方向，本轮没有声称这些改造已经落地，也没有调用付费识别服务。

## 证据边界

既有 REA 父证据 ID：`ev_655e9d1830f94fa678c517ed2fd9b637ba15a8270afa13324bc24c4227dd122a`；原始 ASAR SHA-256：`fa341adaa9dfc5102d3bc3a950c06034a7c353548f6d833434d403011009e885`。历史工具只分析选定模块，覆盖 partial，且记录过原生库哈希差异与环境限制，详见 `ASR-DIAGNOSIS.md`。本轮对保留源码的补充阅读不是新一次 REA 运行或动态执行证据。

已回答：公开供应商合作、临时结果修订机制、客户端相关事件、我们的延迟设计差异。部分回答：原版这次具体实时翻译会话为何快。仍未知：该会话实际供应商/版本、服务端推理参数、部署硬件、准确率与延迟的同音频对照。公开资料中的“比打字快 4 倍”不是 ASR 首字延迟指标。
