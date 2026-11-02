import AppKit
import CoreGraphics
// Tests may send the shortcut only while their own fixture is foreground.
let expected = Int32(CommandLine.arguments[1])!
guard NSWorkspace.shared.frontmostApplication?.processIdentifier == expected else { exit(4) }
let mode = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "dictation"
if mode == "fn" || mode == "rightctrl" || mode == "rightalt" {
    let pressed = CommandLine.arguments[3] == "down"
    let event = CGEvent(keyboardEventSource: nil, virtualKey: mode == "fn" ? 63 : mode == "rightalt" ? 61 : 62, keyDown: pressed)!
    event.type = .flagsChanged; event.flags = CGEventFlags(rawValue: pressed ? (mode == "fn" ? CGEventFlags.maskSecondaryFn.rawValue : mode == "rightalt" ? CGEventFlags.maskAlternate.rawValue | 0x40 : CGEventFlags.maskControl.rawValue | 0x2000) : 0)
    event.post(tap: .cghidEventTap); usleep(30000); exit(0)
}
let key: CGKeyCode = mode == "escape" ? 53 : 2
let down = CGEvent(keyboardEventSource: nil, virtualKey: key, keyDown: true)!
let up = CGEvent(keyboardEventSource: nil, virtualKey: key, keyDown: false)!
down.flags = mode == "escape" ? [] : [.maskCommand, .maskAlternate]; up.flags = []
down.post(tap: .cghidEventTap); usleep(30000); up.post(tap: .cghidEventTap)
