import ApplicationServices
import Foundation
// Test-only emitter. Uses modifier flags only, never text, clipboard or Return.
let key = CommandLine.arguments[1]
let down = CommandLine.arguments[2] == "down"
let code: CGKeyCode = key == "fn" ? 63 : key == "rightalt" ? 61 : 62
let mask: UInt64 = key == "fn" ? CGEventFlags.maskSecondaryFn.rawValue : key == "rightalt" ? CGEventFlags.maskAlternate.rawValue | 0x40 : CGEventFlags.maskControl.rawValue | 0x2000
let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down)!
event.type = .flagsChanged
event.flags = CGEventFlags(rawValue: down ? mask : 0)
event.post(tap: .cghidEventTap)
Thread.sleep(forTimeInterval: 0.04)
