# SpeakBridge 项目约定

## 定位与入口

独立的 Electron 桌面应用，提供实时转写、翻译、字幕、会议纪要和跨应用听写。
技术栈：Electron / React / TypeScript；本地 ASR 使用 sherpa-onnx / ONNX Runtime；原生输入使用 Swift / C#。
先读 [文档索引](docs/README.md)，当前验收范围以 [验证状态](docs/verification.md) 为准。

## 开发命令

- 建议 Node.js 24。先按 [开发指南](docs/development.md) 配好原生编译依赖，再运行 `npm ci`、`npm run dev`。
- `npm test`：逻辑与本机协议测试；`npm run build`：原生组件、类型检查、生产前端。
- `npm run check:sensitive`：常见敏感信息扫描；提交前再检查 `git diff --check`。
- 端到端、真实模型和打包验证按开发指南选择；普通测试通过不能替代实机验收。

## 目录与约定

- `src/`：界面与采集；`electron/`：主进程、IPC、引擎、存储与 Windows 输入组件。
- `native/`：Mac 输入组件；`scripts/`：构建和校验；`tests/`：固定样例与验证。
- `docs/guides/`：当前用法；`docs/archive/`：历史证据；版本变化进入 `CHANGELOG.md`。
- 不把原版应用代码、图标或截图裁切资产纳入产品。保留 `LICENSE`、`THIRD_PARTY_NOTICES.md` 和 `licenses/` 的配布表记。

## 数据与输入边界

- 不提交真实会议、凭据、本机配置、个人路径、`release/` 或 `test-artifacts/`；不打印候选密钥原文。
- 使用隔离数据目录和合成样例验证；不为测试替换真实用户配置或终止正在进行的录音。
- 音频识别、文字引擎和听写整理是独立选择；不能因失败静默切换服务或把 CLI 等同于离线。
- 保持渲染器隔离、IPC 发送者校验、原生输入目标与密码框保护；不得自动按回车提交。
- 不把部分写入或不确定写入当作零写入重试；取消后的迟到结果不能再次输入或恢复已删除记录。

## 状态与后续

源码版本以 `package.json` 为准，历史报告不证明当前服务或安装状态。
涉及 Windows / Intel Mac 实机、真实音频与目标应用输入、云端成功生成的结论，须补对应证据后更新验证状态。
文档维护同一事实只保留一个现行解释，其他位置链接过去；不编辑宿主生成的记忆文件。
