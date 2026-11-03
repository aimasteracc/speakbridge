> 历史归档：保留当时的结论，不代表当前版本或服务状态。现行用法见[文档索引](../../README.md)，验收边界见[验证状态](../../verification.md)。文中测试产物路径相对于项目根目录；未纳入 Git 的本机证据不随源码提供。

最新结果见 [SpeakBridge 0.4.0 识别报告](asr-quality-0.4.md)。以下保留 0.3.0 历史验证。

# SpeakBridge 0.3.0 识别改进验证

验证日期：2026-11-01。设备：Apple Silicon，24 GB 内存。离线 CPU 推理；识别过程不调用 Codex 或其他文字模型。

## 改动与结果

默认本地模型从 Whisper Base q8 改为 SenseVoice Small int8。加入 Silero 人声检测、连续重采样、完整句子识别和中途预览。模型从公开上游下载，校验 SHA-256；保留 Whisper 兼容选项。

| 固定测试子集 | 录音数 | 时长 | 参考字符数 | 旧版字符错误率 | 新版字符错误率 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 中文 | 8 | 105.22 秒 | 301 | 42.52% | 4.98% |
| 日语 | 8 | 90.90 秒 | 366 | 51.37% | 10.66% |

错误率越低越好，以上不是“准确率百分比”。这些结果仅属于固定的小规模公开朗读录音，不能外推到所有口音、会议噪声、多人重叠说话，也不代表与原版 Speakly 云端服务的直接对比。未取得原版服务端的识别模型或同音频转写结果。

## 可复现方法

- 数据集：[Google FLEURS](https://huggingface.co/datasets/google/fleurs)，CC BY 4.0。
- 固定版本：`70bb2e84b976b7e960aa89f1c648e09c59f894dd`。
- 中文 `cmn_hans_cn` 与日语 `ja_jp` 的 test 归档中，各取前 8 个 WAV 条目。下载顺序确定后才开始识别，没有按识别结果挑选样本。
- 参考文本来自发布者的 `test.tsv`；未将参考文本作为模型提示。文件名、文件哈希、原参考文本记录在 `test-artifacts/asr-quality/corpus.json`。
- 基线重现 0.2.1 的实际链路：24 kHz PCM → 音量门限 / 8 秒分段 → 原重采样 → Whisper Base q8。新版使用相同输入 PCM、相同源语言和相同 700 ms 停顿设置，进入实际生产用的 LocalTranscriber（包括人声检测、预览、分段、最终转写）。
- 两边均关闭翻译；将最终段按时间顺序连接。文本做 NFKC、拉丁字母小写及标点/空格移除，随后计算 Levenshtein 字符编辑距离。每种语言先合计编辑距离，再除以参考字符总数，未平均每句百分比。
- 完整逐条结果：`test-artifacts/asr-quality/results.json`。汇总：`test-artifacts/asr-quality/summary.json`。
- 实测新版处理耗时约为音频长度的 0.015 倍；该值排除了模型加载、实时等待与文字翻译，不能当作用户看到字幕的延迟。

复现时先准备模型目录，再执行：

```sh
python3 scripts/fetch-asr-corpus.py
npm run test:asr
```

## 分段和字幕行为

- 本地输入以 Silero 判断人声。保留约 320 ms 前置音频，按用户设置的停顿时长定稿。
- 连续说话每积累约 4 秒音频生成可修订的预览；只翻译最终定稿。慢设备可跳过排队中的预览，不静默丢弃最终识别任务。
- 长句超过 12 秒时寻找短停顿；持续无停顿时在约 24 秒处有界切分，保留 1 秒重叠。只对有声学重叠的相邻段去除可确认的共同文本前缀；不对普通重复发言去重。
- 长句保留更多句内声学上下文。本版本没有声称支持跨段文字记忆；本地词典热词能力也没有虚构接入。
- 额外测试通过：纯静音、固定种子白噪声不生成文本；长音频分段样本覆盖无缺口；传递音频缓冲区后仍保留尾部重叠；停止时排空最后一句及其翻译。
- 按原速注入一段 15.42 秒的真人中文长句，Electron 中约 6.41 秒看到第一条预览，最终保存完整一段。时间含输入开头的非语音、IPC 和 UI 调度；不是所有录音都会得到相同延迟。原速测试使用公开音频，不自动打开用户麦克风。

## 跨平台实现与范围

SenseVoice 和 VAD 通过 `sherpa-onnx-node@1.13.8` 运行，对应平台原生库也固定为 1.13.8。Whisper 保留 ONNX Runtime 1.22.0 以兼容 Intel Mac。识别与人声检测各在独立进程运行，避免 Windows 下不同版本的同名 ONNX DLL 相互影响；父进程退出会结束推理子进程。

macOS Apple Silicon 的开发应用已验证；最终包的检查见 `docs/archive/reports/qa-history.md`。Windows x64、Intel Mac 提供构建产物和架构检查，未在相应硬件上运行。未验证真实麦克风噪声环境、多人会议、所有语言以及原版云端准确率。

上游：[SenseVoice](https://github.com/QwenAudio/SenseVoice)、[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)、[Silero VAD](https://github.com/snakers4/silero-vad)、[固定 SenseVoice ONNX 文件](https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/tree/2365baeacb507f821a0c8120fcee3d484dba7a07)。
