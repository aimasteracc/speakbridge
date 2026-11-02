import AppKit
import WebKit
import AVFoundation

// Disposable, local-only UI fixture. Drive with the computer-use tool, not a
// synthetic input driver. Only this fixture's public test text is reported.
final class Fixture: NSObject, NSApplicationDelegate, NSTextViewDelegate, WKScriptMessageHandler, AVAudioPlayerDelegate {
    var window: NSWindow!
    let native = NSTextView(frame: NSRect(x: 24, y: 335, width: 712, height: 100))
    let secure = NSSecureTextField(frame: NSRect(x: 24, y: 275, width: 712, height: 32))
    var web: WKWebView!
    let status = NSTextField(labelWithString: "等待测试")
    var rows: [String: Any] = ["nativeInputEvents": 0, "web": [:]]
    var clipboardBefore: [String: Data] = [:]
    var player: AVAudioPlayer?
    var lastField = 0
    func clipboardSnapshot() -> [String: Data] {
        var result: [String: Data] = [:]
        for (index, item) in (NSPasteboard.general.pasteboardItems ?? []).enumerated() {
            for type in item.types { result["\(index):\(type.rawValue)"] = item.data(forType: type) }
        }
        return result
    }
    func checkClipboardLater() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { self.rows["clipboardRestored"] = self.clipboardBefore == self.clipboardSnapshot(); self.save() }
    }
    func save() {
        rows["native"] = native.string
        rows["secureLength"] = secure.stringValue.utf16.count
        rows["isActive"] = NSApp.isActive
        let output = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "/tmp/speakbridge-input-fixture-result.json"
        if let data = try? JSONSerialization.data(withJSONObject: rows, options: [.prettyPrinted, .sortedKeys]) { try? data.write(to: URL(fileURLWithPath: output)) }
        status.stringValue = "原生输入事件：\(rows["nativeInputEvents"] ?? 0)　密码框字符数：\(secure.stringValue.count)　测试音频：\(rows["audioPlayback"] ?? "未播放")"
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 760, height: 560), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "SpeakBridge 独立输入测试"; window.center()
        let menu = NSMenu(), main = NSMenuItem(); menu.addItem(main)
        let appMenu = NSMenu(); main.submenu = appMenu; appMenu.addItem(withTitle: "退出测试", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let editItem = NSMenuItem(); menu.addItem(editItem); let editMenu = NSMenu(title: "编辑"); editItem.submenu = editMenu
        editMenu.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        NSApp.mainMenu = menu
        let view = window.contentView!
        let title = NSTextField(labelWithString: "独立测试输入框 · 不自动发送")
        title.frame = NSRect(x: 24, y: 512, width: 450, height: 24); view.addSubview(title)
        let play = NSButton(title: "播放测试语音（3秒后）", target: self, action: #selector(playTestAudio))
        play.frame = NSRect(x: 500, y: 505, width: 235, height: 32); view.addSubview(play)
        for (i, name) in ["普通输入框", "网页文本框", "富文本输入框", "密码框", "检查结果"].enumerated() {
            let button = NSButton(title: name, target: self, action: #selector(focusField(_:))); button.tag = i
            button.frame = NSRect(x: 20 + i * 145, y: 460, width: 140, height: 32); view.addSubview(button)
        }
        native.font = .systemFont(ofSize: 20); native.isRichText = false; native.delegate = self
        native.setAccessibilityLabel("普通输入框"); view.addSubview(native)
        secure.placeholderString = "密码框：应拒绝自动输入"; secure.setAccessibilityLabel("测试密码框"); view.addSubview(secure)
        let config = WKWebViewConfiguration(); config.userContentController.add(self, name: "result")
        web = WKWebView(frame: NSRect(x: 24, y: 45, width: 712, height: 210), configuration: config); view.addSubview(web)
        web.loadHTMLString("""
        <!doctype html><meta charset="utf-8"><style>body{font:16px sans-serif;margin:8px}textarea,[contenteditable]{display:block;box-sizing:border-box;width:96%;height:62px;border:1px solid #999;padding:8px;font:18px sans-serif;margin:5px}</style>
        <label>网页文本框<textarea id="plain" aria-label="网页文本框"></textarea></label>
        <label>富文本输入框<div id="rich" role="textbox" aria-label="富文本输入框" contenteditable="true"></div></label>
        <script>const values={plain:'',rich:'',events:{plain:0,rich:0},enters:0};
        function report(){webkit.messageHandlers.result.postMessage(values)}
        for(const id of ['plain','rich'])document.getElementById(id).addEventListener('input',e=>{values[id]=id==='plain'?e.target.value:e.target.textContent;values.events[id]++;report()});
        addEventListener('keydown',e=>{if(e.key==='Enter'){values.enters++;report()}}); report();</script>
        """, baseURL: nil)
        status.frame = NSRect(x: 24, y: 10, width: 712, height: 24); view.addSubview(status)
        window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true); save()
    }
    @objc func focusField(_ sender: NSButton) {
        NSApp.activate(ignoringOtherApps: true); window.makeKeyAndOrderFront(nil)
        rows["focusLosses"] = 0
        clipboardBefore = clipboardSnapshot()
        if sender.tag < 4 { lastField = sender.tag }
        switch sender.tag {
        case 0: window.makeFirstResponder(native)
        case 1, 2: window.makeFirstResponder(web); web.evaluateJavaScript("document.getElementById('\(sender.tag == 1 ? "plain" : "rich")').focus()", completionHandler: nil)
        case 3: window.makeFirstResponder(secure)
        default: save()
        }
        save()
    }
    @objc func playTestAudio() {
        guard let url = Bundle.main.url(forResource: "test-speech", withExtension: "aiff"), let audio = try? AVAudioPlayer(contentsOf: url) else {
            rows["audioPlayback"] = "音频文件不可用"; save(); return
        }
        let button = NSButton(); button.tag = lastField; focusField(button)
        player?.stop(); player = audio; audio.delegate = self; audio.prepareToPlay()
        rows["audioPlayback"] = "等待播放"; save()
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
            guard self.player === audio else { return }
            self.rows["audioPlayback"] = audio.play() ? "正在播放" : "播放失败"; self.save()
        }
    }
    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        rows["audioPlayback"] = flag ? "播放结束" : "播放失败"; save()
    }
    func applicationDidBecomeActive(_ notification: Notification) { save() }
    func applicationDidResignActive(_ notification: Notification) { rows["focusLosses"] = (rows["focusLosses"] as? Int ?? 0) + 1; save() }
    func textDidChange(_ notification: Notification) { rows["nativeInputEvents"] = (rows["nativeInputEvents"] as? Int ?? 0) + 1; save(); checkClipboardLater() }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) { rows["web"] = message.body; save(); checkClipboardLater() }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
let app = NSApplication.shared
let delegate = Fixture(); app.delegate = delegate; app.setActivationPolicy(.regular); app.run()
