# 引擎与连接配置

[返回文档索引](../README.md)

## 三个独立选择

| 设置 | 负责什么 | 可选路径 |
| --- | --- | --- |
| 语音转写引擎 | 会议音频转文字 | 本地模型、OpenAI 兼容实时 API、Soniox |
| 翻译与纪要引擎 | 翻译和生成会议纪要 | API、Codex、Claude Code、DeepSeek Harness、Ollama、自定义 Harness |
| 语音输入 → 听写输出 | 本地听写定稿后的可选文字整理 | 默认原文直出；也可明确选用上述文字引擎 |

跨应用听写始终用麦克风和本地语音模型；可选整理只处理定稿文字。会议的文字引擎与听写整理选择互不切换，但复用相应服务的连接参数。

自动模式的实际规则：有通用 API Key 时，会议语音和所需文字任务优先选 API；没有 Key 时，语音选本地，文字依次选已检测到的 Codex、Claude、DeepSeek Harness，否则尝试 Ollama。Soniox 必须主动选择。服务出错不会自动转投另一家。需要明确数据去向时，请显式选择引擎。

## DeepSeek API

以下是当前代码与测试使用的 DeepSeek 文字配置。它不会把 DeepSeek 文字模型当作语音接口；模型名称、账户权限和服务可用性仍由实际部署决定。

| 设置项 | 填写内容 |
| --- | --- |
| 语音转写引擎 | **本地模型 · 人声检测与转写**；先下载选中的本地模型 |
| 翻译与纪要引擎 | **云端 API** |
| “OpenAI 兼容服务”区域的 API Key | 只在应用密码输入框粘贴 DeepSeek Key 并保存 |
| API 地址 | `https://api.deepseek.com`，不要附加 `/responses` |
| 翻译 / 纪要模型 | 仓库测试配置为 `deepseek-flash`；按账户实际支持的模型填写 |

1. 点“保存设置”，确认 API Key 显示“已加密保存”。创建了平台密钥但尚未保存到声桥，仍会报“所选 API 引擎需要密钥”。
2. 点“保存并测试连接”。显式选 API 文字引擎后，即使关闭翻译，也会发送固定短文验证文字接口；可能产生少量费用。
3. 测试通过后，对已结束的会话生成纪要，按需选择自动／中文／日文／英文。

应用在 API 地址后拼接 **`/responses`**，不是 `/chat/completions`。仅支持 Chat Completions 的兼容服务不能直接替代。通用 API Key 与 Soniox Key 独立；不要把 DeepSeek Key 填进 Soniox 输入框。

纪要上下文与输出 token 设置见[会议纪要](meeting-notes.md#长会议与模型容量)。本次文档整理没有调用 DeepSeek，不能据此认定当前账户连接成功。

## 本地语音模型

| 模式 | 首次下载约量 | 行为 |
| --- | ---: | --- |
| SenseVoice（默认） | 240 MB | 资源占用较低；支持中、日、英、韩及粤语；约每 0.8 秒尝试更新预览 |
| Qwen3-ASR 1.7B | 2.4 GB | 多语言；接收个人词典提示；建议至少 8 GB 内存 |
| Whisper Large v3 Turbo | 1.04 GB | 多语言单模型；不接收个人词典 |
| Whisper Base | 80 MB | 较小的多语言兼容选项；不接收个人词典 |
| 增强识别 | 3.7 GB | SenseVoice 预览，Qwen3-ASR 与 Whisper Turbo 复核定稿；建议至少 16 GB 内存 |

下载量为近似值，包含所需检测组件；模型文件按需下载、校验 SHA-256，并在模式间共享。运行安装包的本地识别不需要额外安装 Python 或 ffmpeg。

增强识别支持自动、中、日、英、韩；不支持的源语言会在开始前提示。增强识别保守合并三路声学结果，不代表每句话都更准，定稿也更慢。Qwen3-ASR 与增强模式中的 Qwen 分支接收词典，含分隔符的提示合计上限为 256 UTF-8 字节；词典不是强制替换规则。文字翻译、API 识别和听写整理也可使用词典提示。

本地模型使用 VAD 和音频窗口产生可修订预览，再定稿。SenseVoice / 增强模式约每 0.8 秒尝试预览，其余模式约每 4 秒；算力不足时会跳过过期预览。延迟、准确率的证据与限制见[验证状态](../verification.md)。

## 其他 API 与 Soniox

默认通用 API 配置在 [core.cjs](../../electron/core.cjs)：地址 `https://api.openai.com/v1`、转写模型 `gpt-live-transcribe`、文字模型 `gpt-4.1-mini`。这是程序默认值，实际可用模型取决于账户及接口。语音需要相应 Realtime 转写协议，文字需要 Responses API。

Soniox 使用独立 API Key 和官方实时转写端点。主动选中后持续发送音频，支持临时文本修订和最终确认；翻译与纪要继续走选中的文字引擎。保存设置本身不发起测试请求；“保存并测试连接”会发送约 0.1 秒静音，并按配置测试文字引擎。它是付费云服务，不能用本机协议模拟结果推断真实识别质量。

## Ollama、CLI 与 Harness

| 引擎 | 准备和边界 |
| --- | --- |
| Ollama | 启动本机服务，默认 `http://127.0.0.1:11434`；用 `ollama list` 确认已下载模型，将准确名称填入设置。应用不会替你下载文字模型。要离线处理，必须选真正的本地模型，环回地址不代表云端模型也离线 |
| Codex / Claude Code | 先用对应官方 CLI 完成登录，确保程序可被检测或填写绝对路径。适配器沿用 CLI 的认证环境，通常仍调用云端并使用账户额度；不需要在声桥中粘贴 CLI 登录令牌 |
| DeepSeek Harness（dsh） | 选择“DeepSeek Harness”，配置可执行文件或 JS 入口及配置目录。默认目录由 `DSH_HOME` 或 `~/.dsh` 决定；JS 入口需要 Node.js。不会自动联网安装 CLI；Harness 本身不提供免费模型或语音识别 |
| 自定义 Harness | 配置可信可执行程序的绝对路径和 JSON 参数数组，协议见[开发指南](../development.md#自定义-harness-协议) |

内置 Codex / Claude 适配器限制工具并使用临时工作目录。DeepSeek 适配器读取原配置目录的 `settings.yaml` 和 `.credentials.yaml`，在隔离的临时 headless profile 中运行，禁用模型工具；不会继承原 Web profile 的独立插件或只放在原 `.env` 中的设置。旧 CLI 不支持所需参数时，应检查版本兼容性，而不是把错误当作连接成功。

本地语音没有按次 API 费用；联网文字处理、API 转写及 CLI 服务可能收费或扣额度。完整发送范围见[数据与隐私](../security.md)。
