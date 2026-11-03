# 历史归档

[返回现行文档索引](../README.md)

这里保存调查、设计与验收证据。每份材料仅代表原日期和版本；其中的默认设置、服务错误、待办和“当前版本”不应作为现在的操作指引。当前验收结论以[验证状态](../verification.md)为准，各版本摘要见[版本记录](../../CHANGELOG.md)。

## 研究依据

| 文档 | 用途 |
| --- | --- |
| [早期 ASR 差异诊断](research/asr-diagnosis.md) | 追溯 0.2.1 识别限制与改进方向 |
| [Speakly 流式识别调查](research/speakly-streaming.md) | 2026-11-01 的公开资料与客户端行为分析，区分证据与推测 |
| [REA 输入流程对照](research/rea-input-0.7.5.md) | 2026-11-02 的目标定位、悬浮条及自动交付改造依据 |

## 评测与清理记录

| 文档 | 范围 |
| --- | --- |
| [0.3 ASR 评测](reports/asr-quality-0.3.md) | 16 段公开真人朗读的旧／新流程比较 |
| [0.4 ASR 评测](reports/asr-quality-0.4.md) | 方案选择与独立验证，不含原版同音频比较 |
| [旧版 QA 汇编](reports/qa-history.md) | 0.2.1–0.7.8 的验证快照，按原顺序保留 |
| [2026-11-02 敏感信息清理](reports/privacy-cleanup-2026-11-02.md) | 当次迁移、脱敏和检查范围；当时无 Git 历史的描述不适用于现在 |

## 版本实施记录

| 版本 | 文档 |
| --- | --- |
| 0.5.0 | [流式预览与延迟](releases/0.5.0-streaming.md) |
| 0.5.1 | [修订显示与滚动](releases/0.5.1-visual.md) |
| 0.5.2 | [纯标点过滤与连续出字](releases/0.5.2-streaming-display.md) |
| 0.6.0 | [跨应用本地听写](releases/0.6.0-dictation.md) |
| 0.7.0 | [操作体验与快捷键](releases/0.7.0-usability.md) |
| 0.7.9 | [配色切换](releases/0.7.9-appearance.md) |
| 0.7.10 | [多语言与长会议纪要](releases/0.7.10-meeting-notes.md) |
| 0.7.11 | [可选听写整理](releases/0.7.11-dictation-cleanup.md) |

## UI 设计与素材来源

[设计提案](design/proposal.md)与[素材审查记录](design/review.md)是 0.7.8 后的历史设计工作，并非完整的现行产品规格。后续配色实际实现见上表 0.7.9 记录。

- 概念图：[实时翻译](design/realtime-concept.png)、[会议纪要](design/minutes-concept.png)。使用架空数据，为生成式设计评审材料，不是可直接用于产品的图标来源。
- 核对数据：[素材清单](design/asset-inventory.json)、[概念图哈希](design/concept-manifest.json)。
- 外部设计工具的 [MIT 原文](design/UI-UX-Pro-Max-LICENSE.txt)；应用实际配布的表记仍在根目录 [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md) 与 [licenses](../../licenses)。

归档中的代码块／测试产物路径以项目根目录为基准。未纳入 Git 的安装包、截图、运行日志和私有原版证据不随源码提供；不为补链接重新复制这些数据。原文中的命令和审批描述是历史记录，不是要求读者现在执行的任务。
