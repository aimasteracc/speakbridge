> 历史归档：保留当时的结论，不代表当前版本或服务状态。现行用法见[文档索引](../../README.md)，验收边界见[验证状态](../../verification.md)。文中测试产物路径相对于项目根目录；未纳入 Git 的本机证据不随源码提供。

# SpeakBridge 0.4.0 识别验证

2026-11-01，Apple Silicon / 24 GB 内存，离线 CPU 推理。这里比较的是我们自己的 0.3.0 与 0.4.0；没有原版 Speakly 的同音频转写，不能宣称已超过原版。REA 是此前分析程序的工具，不是本次语音识别引擎。

## 独立验证结果

方案确定后，使用未参与选择的 32 段公开真人朗读录音（中文、日语各 16 段）。字符错误率 CER 越低越好，不能简单称为“准确率”。

| 条件 | 语言 | 参考字符 | 0.3.0 错误数 / CER | 0.4.0 增强模式错误数 / CER | 错误数相对减少 |
| --- | --- | ---: | ---: | ---: | ---: |
| 原始录音 | 中文 | 586 | 68 / 11.60% | 64 / 10.92% | 5.9% |
| 原始录音 | 日语 | 837 | 83 / 9.92% | 58 / 6.93% | 30.1% |
| 加 10 dB 白噪声 | 中文 | 586 | 76 / 12.97% | 69 / 11.77% | 9.2% |
| 加 10 dB 白噪声 | 日语 | 837 | 152 / 18.16% | 123 / 14.70% | 19.1% |

原始录音总长约 6 分 49 秒。加噪声是对同一批录音的压力测试，不是额外 32 个独立样本。中文提升较小，不能据此断言对所有中文场景都更好。中文 16 段中 3 段改善、12 段相同、1 段变差；日语 7 段改善、7 段相同、2 段变差。小样本结果没有统计显著性保证。

逐条结果及参考文本在 `test-artifacts/asr-validation/`。`sensevoice-*-summary.json` 与 `ensemble-*-summary.json` 为汇总；`0.3.0-sensevoice-*` 是实际旧发布包复核的基线。原始录音及加噪声基线均已与旧包复核一致。

## 实现

增强模式使用三个独立的本地声学模型：SenseVoice Small int8、Qwen3-ASR 1.7B int8、Whisper Large v3 Turbo int8。SenseVoice 显示预览；定稿再顺序调用另外两个模型。对齐到同一位置后，只有另外两路一致且与初稿不同的词才替换。拉丁词与数字作为整体，避免拼出不存在的人名；结果过长、两路差异过大或缺少结果时保留初稿。没有调用 Codex、Claude 或 DeepSeek 来猜测缺失文字。

三个模型仍可能一起听错。没有把模型一致性当作经过校准的置信度，也不承诺原来正确的句子绝不会被改错。

增强模式、Qwen3-ASR 和 Whisper Turbo 保留至少 1.2 秒停顿，取消 12 秒后遇到 192 ms 短停顿就切分的策略。保留 Silero 人声检测、320 ms 预缓冲、约 4 秒一次预览、24 秒最大分段和 1 秒重叠。SenseVoice 单模型与 Whisper Base 保留旧行为。只有最终文本进入翻译。

Qwen3-ASR 使用个人词典作为声学解码提示，增强模式中也传给 Qwen 分支，合计最多 256 UTF-8 字节。SenseVoice / Whisper 分支不接收词典；增强模式不会仅因为词典中出现了某个名称就强行替换。Qwen 在固定中文源语言下只整理明确的年月日数字写法，不改写模糊数量或人名。

**词典效果的边界：**直接对一个原始 16 kHz WAV 推理时，提示 `Oravec` 曾把 `work` 改为正确的人名；但同一录音经过实际 24 kHz 采集转换及 VAD 后，仍输出 `work`。诊断确认最终识别请求确实收到词典，单段保留了整句话；即使不做 VAD、只做采样转换，该示例也会漏识别。不能把最初的直接 WAV 成功当作产品链路成功，词典不是识别人名的保证。完整诊断在 `test-artifacts/asr-research/hotword-pipeline-diagnostic.json`。

## 方案选择与方法

先用固定的 64 段录音（每种语言前 32 段）比较方案。它们已用于选择和迭代，属于开发数据，不能再称为盲测：

| 生产链路方案 | 中文 CER（1093 字） | 日语 CER（1547 字） |
| --- | ---: | ---: |
| 0.3.0 SenseVoice 配置 | 7.50% | 10.47% |
| Qwen3-ASR 1.7B，完整停顿 | 7.78% | 12.15% |
| Whisper Turbo，完整停顿 | 9.70% | 8.73% |
| 0.4.0 三模型复核，完整停顿 | 6.86% | 8.99% |

单独换成大模型没有全面胜出。另试过 Qwen 0.6B、FunASR Nano、FireRed2，但没有把它们加入产品。直接 WAV 的初步试验与完整采集链路的结果不同；以上表格使用实际生产 `LocalTranscriber`，不是三个完整文件输出的事后投票。实验日志保留，未采用模型的大文件已清理。

- 数据：[Google FLEURS](https://huggingface.co/datasets/google/fleurs)，CC BY 4.0；固定版本 `70bb2e84b976b7e960aa89f1c648e09c59f894dd`。
- 中文 `cmn_hans_cn`、日语 `ja_jp`，按 test 归档中 WAV 条目的顺序取样。1–32 用于开发；33–48 用于独立验证，没有按识别表现筛选录音。测试脚本保留的 `development/holdout` 旧字段按第 8 条划分，仅用于历史兼容，不代表 9–32 条是盲测。
- 参考文本只进入评分器，不进入识别提示；准确率评测全部使用空词典、关闭翻译。前述人名提示诊断不计入准确率。
- 所有录音先统一为单声道 24 kHz PCM16，再进入连续重采样、人声检测、预览、分段、复核及最终文本保存。每个文件开始前校验 SHA-256。评测快速注入 PCM，字幕实际等待另用原速注入的安装包测试验证。
- 文本先 NFKC、小写，删除空格和标点，再计算 Levenshtein 字符距离。CER = 替换、删除、插入总数 / 参考字符总数；不平均逐句百分比，不把中文数字额外等价化。
- 噪声使用固定种子 41 的白噪声，以整段信号功率设为 10 dB 信噪比并限幅。它不等于真实会议回声、远场、口音或多人叠音。
- 大模型候选使用统一的 sherpa-onnx 2.0.1。独立验证的原始及加噪声录音基线另外使用实际 0.3.0 包及其 1.13.8 原生库复查，两者字符错误数一致。

## 资源、费用与限制

增强模式所需文件约 3.7 GB，推荐至少 16 GB 内存；已有模型文件共享使用。三路最终推理比 SenseVoice 慢，长句预览仍由 SenseVoice 完成。机器负载、音频长度和语言都会影响耗时；离线批处理 RTF 排除了启动和录音等待，不能当作字幕延迟。

本地识别不收 API 调用费，下载后不上传音频；本机运行仍消耗内存、CPU 和电量。翻译与会议纪要按现有引擎配置运行，Codex / Claude / DeepSeek 云端服务仍可能使用订阅或 API 额度。

Windows x64、Mac arm64 与 Mac x64 已构建并校验 ZIP、源码一致性与原生库架构。实际安装包推理测试只在 Apple Silicon 上进行；Windows 与 Intel Mac 尚未实机验收，安装包未签名或公证。此次没有采集用户的真实麦克风，也没有测原版 Speakly。

## 复现与证据

模型可以通过应用设置准备。开发评测需要 Python（下载公开语料）、ffmpeg 和 Node；这些不是普通用户运行应用的额外依赖。

```sh
python3 scripts/fetch-asr-corpus.py --count 48 --output test-artifacts/asr-validation
ASR_CORPUS_DIR=test-artifacts/asr-validation ASR_MIN_RANK=33 node tests/asr-evaluate.cjs sensevoice clean
ASR_CORPUS_DIR=test-artifacts/asr-validation ASR_MIN_RANK=33 node tests/asr-evaluate.cjs ensemble clean
ASR_CORPUS_DIR=test-artifacts/asr-validation ASR_MIN_RANK=33 node tests/asr-evaluate.cjs sensevoice noise10
ASR_CORPUS_DIR=test-artifacts/asr-validation ASR_MIN_RANK=33 node tests/asr-evaluate.cjs ensemble noise10
```

评测默认读取 `test-artifacts/models`。Windows 可在 PowerShell 中设置同名环境变量。使用旧 Mac 包复核时，以该包可执行文件设置 `ELECTRON_RUN_AS_NODE=1` 启动脚本，并将 `ASR_RUNTIME_ROOT` 指向其 `Contents/Resources/app.asar/electron`、`ASR_OUTPUT_TAG=0.3.0-`。

功能与安装包验证见 [QA.md](qa-history.md)。包校验结果在 `test-artifacts/package-0.4.0-verification.json`，下载包哈希在 `release/0.4.0/SHA256SUMS.txt`。旧源码备份为 `test-artifacts/asr-research/source-0.3.0.tar.gz`，旧发布包也保留。

上游资料：[Qwen3-ASR](https://github.com/QwenLM/Qwen3-ASR)、[sherpa-onnx Qwen3-ASR 支持与模型](https://k2-fsa.github.io/sherpa/onnx/qwen3-asr/pretrained.html)、[Whisper 模型](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/whisper/index.html)。Qwen ONNX 转换文件来自 ModelScope 的 `zengshuishui/Qwen3-ASR-onnx`，Whisper Turbo 文件来自 `csukuangfj/sherpa-onnx-whisper-turbo`；版本、大小和 SHA-256 固定在 `electron/model-assets.cjs`，不是从原版应用提取的私有控件。
