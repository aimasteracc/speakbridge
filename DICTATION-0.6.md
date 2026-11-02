# 0.6.0 跨应用本地听写

新增侧栏「语音输入」与独立快捷键 `Cmd/Ctrl + Shift + D`。在其他应用的普通文字输入框中按一次开始，再按一次结束。悬浮窗口显示可修改的识别初稿；停止并完成最终识别后，才发送文字到原输入框。不会按回车提交消息。

## 使用

1. 在「设置」中下载并保存所选本地语音模型。
2. 打开「语音输入」，点击「准备麦克风」；Mac 再点击「检查输入权限」，在系统设置的辅助功能中允许声桥。未签名应用升级或移动路径后可能需要重新授权。
3. 回到目标应用，点击普通文字输入框，按 `Cmd/Ctrl + Shift + D` 开始说话。不要在听写时移动光标或切换输入框。
4. 再按同一快捷键结束，等待定稿。输入事件发出后请检查文字；不支持自动输入时使用「复制文字」。每次最长 2 分钟，达到上限会自动收尾。
5. 悬浮窗口右上角取消本次听写；定稿输入阶段不提供重新发送，以避免重复输入。识别失败、纯标点、取消或焦点变化时保留提示和可用文本，不自动重试。

## 数据边界

听写强制使用本地语音模型、麦克风、关闭翻译；即使常规会话配置了 API Key、系统音频、云端翻译，也不会改变这一规则。不会触发 Codex、Claude Code、DeepSeek Harness 或生成纪要。常规会话的引擎设置保持原样。

听写结果与音频不写入会话历史文件；当前结果只在应用内存中保留，下一次会话会替换它。模型文件仍保存在本机模型目录。0.7.3 起，Mac 自动输入临时使用限定本机的剪贴板，粘贴后恢复原数据与格式；若用户期间复制了新内容则保留新内容。Windows 沿用 Unicode 输入。主动点击复制会覆盖剪贴板。目标软件自身的同步、上传、草稿或剪贴板管理软件的行为不受声桥控制。本模式不是覆盖整个应用的企业离线策略，普通会议模式仍使用其所选服务。

## 实现与兼容性

- Mac 使用独立 Swift 输入组件，辅助功能接口只检查输入元素、角色及选区，不读取目标正文；通过 Unicode 键盘事件输入，不模拟粘贴。查询应用级 AX 焦点，并处理 workspace 事件通知。每一批输入前检查前台进程与输入元素，初次输入时检查可获得的选区位置。
- Windows 使用 .NET Framework 4.8 x64 组件，通过 UI Automation 验证非密码编辑元素与目标窗口，再用 `SendInput` 发送 Unicode。打包包含已编译组件，用户不需要 SDK、PowerShell 脚本或运行编译器。
- 两个平台都等快捷键修饰键释放后再输入。文字中的控制符、换行和制表符转为空格，避免触发提交和跳转焦点。若输入中途切换焦点，停止后续批次，并提示检查已经写入的部分。
- 不保证所有输入控件可用。密码框、没有可访问编辑元素的自绘控件、拒绝合成输入的应用、Windows 高权限窗口可能需要手动复制。Windows 不尝试提权；Mac 不自动更改辅助功能授权。
- 快捷键已被占用时会提示。程序须保持运行；关闭主窗口会退出程序。
- macOS 13+，Apple Silicon / Intel；Windows 10 / 11 x64。安装包未签名或公证。

原生接口参考：[Apple Unicode 键盘事件](https://developer.apple.com/documentation/coregraphics/cgevent/keyboardsetunicodestring(stringlength:unicodestring:))、[Microsoft SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)。键盘事件成功发送并不等于每个应用都会接受它，因此界面使用「文字已发送到原输入框，请检查结果」。

## 构建

`npm run build` 会编译 Mac arm64 / x64 输入组件，并检查 Windows 二进制与源码哈希。Windows 上可用系统自带 .NET Framework 编译器重新构建组件。

Mac 上交叉构建 Windows 组件时，需要官方 .NET SDK 与 `Microsoft.NETFramework.ReferenceAssemblies.net48` NuGet 包中的参考程序集。设置 `SPEAKBRIDGE_DOTNET_DIR` 为 SDK 根目录、`SPEAKBRIDGE_NET48_REFS` 为参考包的 `build/.NETFramework/v4.8`，运行 `node scripts/build-dictation-win.mjs`。本次使用官方 .NET SDK 8.0.427，下载归档通过发布元数据 SHA-512 校验；C# 以语言版本 5、net48 / x64 目标交叉编译。`electron/native/dictation-win.build.json` 固定源码和产物 SHA-256。

## 验证

- `npm test`：55 项逻辑测试，包括本地路由隔离、控制符清理、取消/不完整/空文本、部分输入失败不重试、原生组件崩溃收尾。
- `node tests/dictation.e2e.cjs`：隔离数据目录与另一个 Electron 测试应用，真实全局快捷键、非激活悬浮窗、中文/英文/emoji 输入、同应用切换输入框、移动光标、切换前台应用、密码框、取消、模型启动中取消、纯标点、手动复制按钮、剪贴板内容与格式保持不变。
- 同一测试将公开中文录音通过合成 MediaStream → AudioWorklet → 原生 VAD / SenseVoice → OS 输入，检查输入框文字等于最终识别结果。不使用用户真实麦克风、会议文本或用户数据目录；记录未发出 HTTP 请求、未创建听写历史、没有改变原来的 API 设置。
- Windows 输入组件完成交叉编译；Windows 与 Intel Mac 的真实桌面输入尚未实机验收。

最终 Mac arm64 安装包通过上述 12 组听写检查、原有 8 组 Electron 功能场景及 10 组字幕视觉场景。3 个发布包通过源码/前端/原生输入组件一致性、架构、ZIP 完整性和 SHA-256 校验。测试结果位于 `test-artifacts/dictation-0.6.0/result.json`（`packaged: true`）、`test-artifacts/e2e-0.6.0.json`、`test-artifacts/visual-0.6.0/result.json` 和 `test-artifacts/package-0.6.0-verification.json`。这次扩展使用场景，没有更换识别模型或宣称识别率提升。
