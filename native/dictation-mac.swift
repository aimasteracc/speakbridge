import AppKit
import ApplicationServices

// Keep the event tap off the request thread: AX calls in another application
// can stall, but a key release must always reach the recording controller.
let outputQueue = DispatchQueue(label: "app.speakbridge.dictation.output")
func output(_ value: [String: Any]) {
    outputQueue.async {
        guard var data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) else { return }
        data.append(10)
        FileHandle.standardOutput.write(data)
    }
}
// The observed original Speakly reserves Fn too. Do not take that shortcut
// from a running installation; alternatives remain explicitly selectable.
let speaklyConflictMessage = "检测到原版 Speakly 正在运行，fn 可能冲突。请退出原版后重新检查，或改用右 Option / 右 Ctrl。"
func originalSpeaklyRunning() -> Bool {
    return NSRunningApplication.runningApplications(withBundleIdentifier: "ai.mainfunc.genspark.voice.beta").contains { !$0.isTerminated }
}
final class HoldMonitor {
    private var loop: CFRunLoop!
    private var keepAlive: Port!
    private var tap: CFMachPort?
    private var source: CFRunLoopSource?
    private var key = "off"
    private var pressed = false
    init() {
        let ready = DispatchSemaphore(value: 0)
        Thread.detachNewThread {
            self.loop = CFRunLoopGetCurrent()
            self.keepAlive = Port()
            RunLoop.current.add(self.keepAlive, forMode: .default)
            ready.signal()
            CFRunLoopRun()
        }
        ready.wait()
    }
    private func release() {
        if pressed { pressed = false; output(["event": "hold", "pressed": false]) }
    }
    private func remove() {
        release()
        if let tap = tap { CGEvent.tapEnable(tap: tap, enable: false); CFMachPortInvalidate(tap) }
        if let source = source { CFRunLoopRemoveSource(loop, source, .commonModes) }
        tap = nil; source = nil; key = "off"
    }
    func configure(_ requested: String) -> [String: Any] {
        guard ["fn", "rightalt", "rightctrl", "off"].contains(requested) else { return ["ok": false, "available": false, "error": "不支持的按住说话快捷键。"] }
        let done = DispatchSemaphore(value: 0)
        var result: [String: Any] = [:]
        CFRunLoopPerformBlock(loop, CFRunLoopMode.defaultMode.rawValue) {
            if requested == "fn" && originalSpeaklyRunning() {
                self.remove()
                result = ["ok": true, "available": false, "conflict": true, "message": speaklyConflictMessage]
            } else if requested == self.key, let tap = self.tap, CGEvent.tapIsEnabled(tap: tap) {
                result = ["ok": true, "available": true, "message": "按住说话已就绪"]
            } else {
                self.remove()
                if requested == "off" { result = ["ok": true, "available": false, "message": "按住说话已关闭"] }
                else if !AXIsProcessTrusted() { result = ["ok": true, "available": false, "message": "请在系统设置 → 隐私与安全性 → 辅助功能中允许声桥，再重新检查。"] }
                else {
                    let mask = (CGEventMask(1) << CGEventType.flagsChanged.rawValue)
                    self.tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .defaultTap, eventsOfInterest: mask, callback: { _, type, event, info in
                        guard let info = info else { return Unmanaged.passUnretained(event) }
                        return Unmanaged<HoldMonitor>.fromOpaque(info).takeUnretainedValue().event(type, event)
                    }, userInfo: Unmanaged.passUnretained(self).toOpaque())
                    if let tap = self.tap, let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0) {
                        self.source = source; self.key = requested
                        CFRunLoopAddSource(self.loop, source, .commonModes)
                        CGEvent.tapEnable(tap: tap, enable: true)
                        result = ["ok": true, "available": true, "message": "按住说话已就绪"]
                    } else {
                        self.remove()
                        result = ["ok": true, "available": false, "message": "无法监听按住快捷键，请检查辅助功能权限；仍可使用免持快捷键。"]
                    }
                }
            }
            done.signal()
        }
        CFRunLoopWakeUp(loop); done.wait()
        return result
    }
    private func event(_ type: CGEventType, _ event: CGEvent) -> Unmanaged<CGEvent>? {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            remove()
            output(["event": "watch-error", "message": "按住快捷键监听已暂停，请在语音输入页重新检查；免持快捷键仍可使用。"])
            return Unmanaged.passUnretained(event)
        }
        let code = event.getIntegerValueField(.keyboardEventKeycode)
        let expected: Int64 = key == "fn" ? 63 : key == "rightalt" ? 61 : key == "rightctrl" ? 62 : -1
        guard type == .flagsChanged, code == expected else { return Unmanaged.passUnretained(event) }
        // Device-dependent right-hand bits distinguish releasing the right key
        // while its left-hand counterpart remains down. Fn has its own bit.
        let mask: UInt64 = key == "fn" ? CGEventFlags.maskSecondaryFn.rawValue : key == "rightalt" ? 0x40 : 0x2000
        let next = event.flags.rawValue & mask != 0
        if key == "fn", next, !pressed, originalSpeaklyRunning() {
            remove()
            output(["event": "watch-error", "conflict": true, "message": speaklyConflictMessage])
            return Unmanaged.passUnretained(event)
        }
        let owned = pressed || next
        if next != pressed { pressed = next; output(["event": "hold", "pressed": next]) }
        // If monitoring started while the key was already held, its down edge
        // reached the OS. Let that unmatched up edge through to avoid a stuck
        // modifier. Otherwise reserve the whole gesture (no emoji/menu popup).
        return owned ? nil : Unmanaged.passUnretained(event)
    }
}
let holdMonitor = HoldMonitor()

// One helper per app; AX references never leave this process. Destination text
// is not read. Clipboard fallback restores all formats and never emits Return.
var target: AXUIElement?
var targetPID: pid_t = 0
var targetRange: CFRange?
func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}
func foregroundPID() -> pid_t? {
    // Refresh workspace notifications before checking focus, including between
    // input batches. Keyboard monitoring has its own run loop.
    RunLoop.current.run(until: Date().addingTimeInterval(0.002))
    return NSWorkspace.shared.frontmostApplication?.processIdentifier
}
func focus() -> AXUIElement? {
    guard let pid = foregroundPID() else { return nil }
    let app = AXUIElementCreateApplication(pid)
    // WebKit can expose its remote web-process focus only via the system-wide
    // object, while some Electron windows expose it only on the application.
    var roots = [AXUIElementCreateSystemWide(), app]
    if let window = attribute(app, kAXFocusedWindowAttribute), CFGetTypeID(window) == AXUIElementGetTypeID() { roots.append(window as! AXUIElement) }
    var fallback: AXUIElement?
    for root in roots {
        var current = root
        var chain: [AXUIElement] = []
        for _ in 0..<6 {
            guard let value = attribute(current, kAXFocusedUIElementAttribute), CFGetTypeID(value) == AXUIElementGetTypeID() else { break }
            let next = value as! AXUIElement
            if CFEqual(current, next) { break }
            current = next; chain.append(next)
        }
        let roles = chain.map { attribute($0, kAXRoleAttribute) as? String ?? "" }
        let subroles = chain.map { attribute($0, kAXSubroleAttribute) as? String ?? "" }
        if let index = focusedTargetIndex(roles: roles, subroles: subroles) {
            let leaf = chain[index]; fallback = leaf
            if editable(leaf) { return leaf }
            // A definitive secure/read-only child must not be replaced by a
            // shallower editable container obtained through another AX root.
            if (roles[index] + subroles[index]).lowercased().contains("secure") ||
               attribute(leaf, "AXReadOnly") as? Bool == true ||
               (["AXTextField", "AXTextArea", "AXSearchField", "AXComboBox", "AXGroup", "AXUnknown"].contains(roles[index]) && attribute(leaf, "AXEditable") as? Bool == false) { return leaf }
        }
    }
    return fallback
}
func prepareAccessibility(_ pid: pid_t) {
    // Chromium/Electron often expose only the window until an assistive client
    // explicitly enables their native accessibility tree.
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 1)
    _ = AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
    _ = AXUIElementSetAttributeValue(app, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
}
func range(_ element: AXUIElement) -> CFRange? {
    guard let value = attribute(element, kAXSelectedTextRangeAttribute), CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
    var result = CFRange()
    return AXValueGetValue(value as! AXValue, .cfRange, &result) ? result : nil
}
// BEGIN INPUT_TARGET_POLICY
func focusedTargetIndex(roles: [String], subroles: [String]) -> Int? {
    guard !roles.isEmpty, roles.count == subroles.count else { return nil }
    for index in roles.indices where (roles[index] + subroles[index]).lowercased().contains("secure") { return index }
    return roles.count - 1
}
// Missing AX metadata is not permission to type into an arbitrary window.
// Some web editors expose an editable group rather than AXTextArea; require
// affirmative editability for those roles, and honor explicit read-only flags.
func acceptsInputTarget(role: String, subrole: String, enabled: Bool?, editable: Bool?, readOnly: Bool?) -> Bool {
    if enabled == false || editable == false || readOnly == true { return false }
    if (role + subrole).lowercased().contains("secure") { return false }
    if ["AXTextField", "AXTextArea", "AXSearchField", "AXComboBox"].contains(role) { return true }
    return editable == true && ["AXGroup", "AXUnknown"].contains(role)
}
// END INPUT_TARGET_POLICY
func editable(_ element: AXUIElement) -> Bool {
    let role = attribute(element, kAXRoleAttribute) as? String ?? ""
    let subrole = attribute(element, kAXSubroleAttribute) as? String ?? ""
    return acceptsInputTarget(role: role, subrole: subrole,
        enabled: attribute(element, kAXEnabledAttribute) as? Bool,
        editable: attribute(element, "AXEditable") as? Bool,
        readOnly: attribute(element, "AXReadOnly") as? Bool)
}
func matches(_ element: AXUIElement) -> Bool {
    guard foregroundPID() == targetPID,
          let focused = focus(), CFEqual(focused, element), editable(focused) else { return false }
    return true
}
func inputDiagnostics(_ stage: String, _ code: String, _ element: AXUIElement? = nil) -> [String: Any] {
    var value: [String: Any] = ["stage": stage, "code": code]
    // Only control capabilities: never query value, selected text, window
    // title, URL or surrounding content. These diagnostics stay in memory.
    if let element = element {
        value["role"] = attribute(element, kAXRoleAttribute) as? String ?? ""
        value["subrole"] = attribute(element, kAXSubroleAttribute) as? String ?? ""
        value["selectionAvailable"] = range(element) != nil
        for (key, name) in [("enabled", kAXEnabledAttribute), ("editable", "AXEditable"), ("readOnly", "AXReadOnly")] {
            if let flag = attribute(element, name) as? Bool { value[key] = flag }
        }
    }
    return value
}
func failure(_ message: String, _ sent: Int = 0, code: String = "INPUT_FAILED", stage: String = "insert", element: AXUIElement? = nil) -> [String: Any] {
    return ["ok": false, "error": message, "sent": sent, "diagnostics": inputDiagnostics(stage, code, element ?? target)]
}
func pasteText(_ text: String, into element: AXUIElement) -> [String: Any] {
    let board = NSPasteboard.general
    let beforeCount = board.changeCount
    var saved: [NSPasteboardItem] = []
    for item in board.pasteboardItems ?? [] {
        let copy = NSPasteboardItem()
        for type in item.types {
            guard let data = item.data(forType: type) else { return failure("无法完整保留剪贴板，未自动输入；可选择输入框后重试。") }
            copy.setData(data, forType: type)
        }
        saved.append(copy)
    }
    guard board.changeCount == beforeCount, matches(element) else { return failure("输入框或剪贴板已改变，未自动输入；文字已保留。") }
    let item = NSPasteboardItem()
    item.setString(text, forType: .string)
    item.setData(Data(), forType: NSPasteboard.PasteboardType("org.nspasteboard.TransientType"))
    board.prepareForNewContents(with: .currentHostOnly)
    let wrote = board.writeObjects([item]), ownedCount = board.changeCount
    defer {
        // Never overwrite a new copy operation performed while paste was pending.
        if board.changeCount == ownedCount { board.prepareForNewContents(with: .currentHostOnly); if !saved.isEmpty { board.writeObjects(saved) } }
    }
    guard wrote, matches(element) else { return failure("未能准备自动粘贴，文字已保留。") }
    let source = CGEventSource(stateID: .privateState)
    guard let down = CGEvent(keyboardEventSource: source, virtualKey: 9, keyDown: true),
          let up = CGEvent(keyboardEventSource: source, virtualKey: 9, keyDown: false) else { return failure("无法创建粘贴事件。") }
    // The key-up carries neutral flags so our synthetic Command does not
    // remain latched in the session and block the next dictation insertion.
    down.flags = .maskCommand; up.flags = []
    down.post(tap: .cghidEventTap); up.post(tap: .cghidEventTap)
    let deadline = Date().addingTimeInterval(1)
    var confirmed = false
    repeat {
        RunLoop.current.run(until: Date().addingTimeInterval(0.025))
        if let previous = targetRange, let current = range(element), current.length == 0,
           current.location == previous.location + text.utf16.count { confirmed = true }
        // Give async editors time to consume the clipboard even after selection updates.
        if confirmed && Date() > deadline.addingTimeInterval(-0.7) { break }
    } while Date() < deadline
    return ["ok": true, "method": "clipboard", "verified": confirmed, "sent": text.utf16.count,
            "diagnostics": inputDiagnostics("insert", confirmed ? "PASTE_VERIFIED" : "PASTE_UNVERIFIED", element)]
}
func handle(_ request: [String: Any]) -> [String: Any] {
    let op = request["op"] as? String ?? ""
    if op == "watch" { return holdMonitor.configure(request["key"] as? String ?? "off") }
    if op == "status" {
        let prompt = request["prompt"] as? Bool ?? false
        let trusted = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: prompt] as CFDictionary)
        return ["ok": true, "available": trusted, "message": trusted ? "跨应用输入权限已就绪" : "请在系统设置 → 隐私与安全性 → 辅助功能中允许声桥；必要时重新打开应用。"]
    }
    if op == "clear" { target = nil; targetRange = nil; return ["ok": true] }
    guard AXIsProcessTrusted() else { return failure("缺少辅助功能权限，文字已保留，可手动复制。", code: "PERMISSION_REQUIRED", stage: op) }
    if op == "capture" {
        target = nil; targetRange = nil
        guard let pid = foregroundPID(), pid != (request["excludePid"] as? Int32 ?? 0) else { return failure("请先点击要输入文字的应用，再按听写快捷键。", code: "TARGET_IS_SELF", stage: "capture") }
        prepareAccessibility(pid)
        var focused = focus()
        // Chromium may publish its accessibility tree asynchronously. This
        // bounded probe now runs alongside recording, not on the mic startup path.
        let deadline = Date().addingTimeInterval(1.5)
        while (focused == nil || !editable(focused!)) && Date() < deadline && foregroundPID() == pid {
            RunLoop.current.run(until: Date().addingTimeInterval(0.025)); focused = focus()
        }
        guard foregroundPID() == pid else { return failure("定位期间切换了应用，听写文字将保留。", code: "FOCUS_CHANGED", stage: "capture", element: focused) }
        guard let element = focused, editable(element) else {
            let secure = focused.map { ((attribute($0, kAXRoleAttribute) as? String ?? "") + (attribute($0, kAXSubroleAttribute) as? String ?? "")).lowercased().contains("secure") } ?? false
            var result = failure(secure ? "密码框不支持自动输入，听写文字将保留。" : "未确认可编辑的输入位置，听写文字将保留。", code: secure ? "TARGET_SECURE" : focused == nil ? "FOCUS_UNAVAILABLE" : "TARGET_NOT_EDITABLE", stage: "capture", element: focused)
            result["appName"] = NSRunningApplication(processIdentifier: pid)?.localizedName ?? "目标应用"
            return result
        }
        target = element; targetPID = pid; targetRange = range(element)
        return ["ok": true, "appName": NSRunningApplication(processIdentifier: pid)?.localizedName ?? "目标应用", "diagnostics": inputDiagnostics("capture", "TARGET_READY", element)]
    }
    guard op == "insert", let element = target else { return failure("原输入框已失效，请复制文字后手动粘贴。") }
    defer { target = nil; targetRange = nil }
    let text = request["text"] as? String ?? ""
    guard !text.isEmpty, text.utf16.count <= 20000, !text.unicodeScalars.contains(where: { $0.properties.generalCategory == .control }) else { return failure("输入文字无效或过长。") }
    // Wait for the global shortcut modifiers to be released, never synthesize
    // releases for keys physically held by the user.
    let mask: CGEventFlags = [.maskCommand, .maskControl, .maskAlternate, .maskShift]
    let deadline = Date().addingTimeInterval(1.5)
    while !CGEventSource.flagsState(.combinedSessionState).intersection(mask).isEmpty && Date() < deadline { Thread.sleep(forTimeInterval: 0.02) }
    guard CGEventSource.flagsState(.combinedSessionState).intersection(mask).isEmpty else { return failure("快捷键仍被按住，请松开后手动复制文字。") }
    guard matches(element) else { return failure("焦点已离开原输入框，未自动输入；文字已保留。", code: "FOCUS_CHANGED") }
    if let old = targetRange, let now = range(element), old.location != now.location || old.length != now.length { return failure("输入位置已改变，未自动输入；文字已保留。", code: "SELECTION_CHANGED") }
    // WebKit can report a successful AXSelectedText write without changing
    // the editor or dispatching input. Use the editor's normal paste action
    // for native and web controls; never infer insertion from setter success.
    return pasteText(text, into: element)
}
// Stdin runs independently; all AX requests remain serialized on the main
// thread while the main run loop receives workspace notifications.
DispatchQueue.global(qos: .userInitiated).async {
    while let line = readLine() {
        DispatchQueue.main.async {
            autoreleasepool {
                var result: [String: Any]
                let request = line.data(using: .utf8).flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
                if let request = request { result = handle(request); result["id"] = request["id"] } else { result = failure("无效请求") }
                output(result)
            }
        }
    }
    DispatchQueue.main.async {
        _ = holdMonitor.configure("off")
        outputQueue.sync {}
        exit(0)
    }
}
CFRunLoopRun()
