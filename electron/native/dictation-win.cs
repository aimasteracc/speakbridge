using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;
using System.Windows.Automation.Text;

// Uses the Windows inbox .NET Framework. No shell commands or automatic Enter.
public class DictationInput {
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public INPUTUNION data; }
    [StructLayout(LayoutKind.Explicit)] struct INPUTUNION {
        [FieldOffset(0)] public KEYBDINPUT keyboard;
        [FieldOffset(0)] public MOUSEINPUT mouse;
    }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort vk, scan; public uint flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, flags, time; public UIntPtr extra; }
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int x, y; }
    [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public POINT pt; public uint lPrivate; }
    [StructLayout(LayoutKind.Sequential)] struct KBDLLHOOKSTRUCT { public uint vkCode, scanCode, flags, time; public UIntPtr extra; }
    delegate IntPtr HookProc(int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetWindowsHookEx(int type, HookProc callback, IntPtr module, uint thread);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll")] static extern int GetMessage(out MSG message, IntPtr window, uint first, uint last);
    [DllImport("user32.dll")] static extern bool PeekMessage(out MSG message, IntPtr window, uint first, uint last, uint remove);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG message);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG message);
    [DllImport("user32.dll")] static extern bool PostThreadMessage(uint thread, uint message, UIntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandle(string module);
    const uint ConfigureMessage = 0x8001;
    static readonly BlockingCollection<Dictionary<string, object>> outputs = new BlockingCollection<Dictionary<string, object>>();
    static readonly ConcurrentQueue<Action> hookActions = new ConcurrentQueue<Action>();
    static readonly ManualResetEvent hookReady = new ManualResetEvent(false);
    static readonly HookProc callback = OnKey;
    static uint hookThreadId;
    static IntPtr hook;
    static int watchedKey;
    static bool held;
    static void Output(Dictionary<string, object> value) { outputs.Add(value); }
    static void ReleaseHold() {
        if (!held) return;
        held = false; Output(new Dictionary<string, object> { { "event", "hold" }, { "pressed", false } });
    }
    static IntPtr OnKey(int code, IntPtr message, IntPtr data) {
        if (code >= 0 && watchedKey != 0) {
            var key = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(data, typeof(KBDLLHOOKSTRUCT));
            if (key.vkCode == watchedKey) {
                int kind = message.ToInt32();
                bool down = kind == 0x100 || kind == 0x104;
                bool up = kind == 0x101 || kind == 0x105;
                bool owned = held || down;
                if ((down || up) && held != down) {
                    held = down;
                    Output(new Dictionary<string, object> { { "event", "hold" }, { "pressed", held } });
                }
                // An unmatched release may belong to a press before watch was
                // enabled. Pass that release through so the OS cannot get stuck.
                if ((down || up) && owned) return new IntPtr(1);
            }
        }
        // AltGr may generate a paired left Ctrl. Never suppress or synthesize
        // either Ctrl edge: doing so can leave Ctrl stuck. Right Alt is reserved
        // while enabled; AltGr keyboard users can select Right Ctrl instead.
        return CallNextHookEx(hook, code, message, data);
    }
    static void HookLoop() {
        hookThreadId = GetCurrentThreadId();
        MSG message; PeekMessage(out message, IntPtr.Zero, 0, 0, 0); // Create thread queue before accepting commands.
        hookReady.Set();
        int result;
        while ((result = GetMessage(out message, IntPtr.Zero, 0, 0)) > 0) {
            if (message.message == ConfigureMessage) {
                Action action; while (hookActions.TryDequeue(out action)) action();
            } else { TranslateMessage(ref message); DispatchMessage(ref message); }
        }
        ClearWorkspace();
        ReleaseHold();
        if (hook != IntPtr.Zero) UnhookWindowsHookEx(hook);
        hook = IntPtr.Zero; watchedKey = 0;
        if (result < 0) Output(new Dictionary<string, object> { { "event", "watch-error" }, { "message", "按住快捷键监听已停止，请重新检查；免持快捷键仍可使用。" } });
    }
    static Dictionary<string, object> Watch(string key) {
        if (key != "rightalt" && key != "rightctrl" && key != "off") return new Dictionary<string, object> { { "ok", false }, { "available", false }, { "error", "Windows 按住说话支持右 Alt 或右 Ctrl。" } };
        Dictionary<string, object> result = null;
        using (var done = new ManualResetEvent(false)) {
            hookActions.Enqueue(() => {
                try {
                    int next = key == "rightalt" ? 0xA5 : key == "rightctrl" ? 0xA3 : 0;
                    if (next != watchedKey) ReleaseHold();
                    if (next == 0) {
                        if (hook != IntPtr.Zero) UnhookWindowsHookEx(hook);
                        hook = IntPtr.Zero; watchedKey = 0;
                        result = new Dictionary<string, object> { { "ok", true }, { "available", false }, { "message", "按住说话已关闭" } };
                    } else {
                        if (hook == IntPtr.Zero) hook = SetWindowsHookEx(13, callback, GetModuleHandle(null), 0);
                        watchedKey = hook == IntPtr.Zero ? 0 : next;
                        result = new Dictionary<string, object> { { "ok", true }, { "available", hook != IntPtr.Zero }, { "message", hook != IntPtr.Zero ? "按住说话已就绪" : "无法监听按住快捷键，仍可使用免持快捷键。" } };
                    }
                } catch {
                    ReleaseHold();
                    if (hook != IntPtr.Zero) UnhookWindowsHookEx(hook);
                    hook = IntPtr.Zero; watchedKey = 0;
                    result = new Dictionary<string, object> { { "ok", false }, { "available", false }, { "error", "无法启动按住快捷键监听，仍可使用免持快捷键。" } };
                } finally { done.Set(); }
            });
            if (!PostThreadMessage(hookThreadId, ConfigureMessage, UIntPtr.Zero, IntPtr.Zero)) return Result(false, "无法连接按住快捷键监听。请重新打开声桥。");
            done.WaitOne();
        }
        return result;
    }
    [StructLayout(LayoutKind.Sequential)] struct MSLLHOOKSTRUCT { public POINT point; public uint mouseData, flags, time; public UIntPtr extra; }
    static readonly HookProc workspaceKeyProc = WorkspaceKey, workspaceMouseProc = WorkspaceMouse;
    static IntPtr workspaceKeyHook, workspaceMouseHook;
    static Dictionary<string, string> workspaceBindings = new Dictionary<string, string>();
    static readonly HashSet<string> workspaceHeld = new HashSet<string>();
    static bool displayKeys;
    static bool WorkspaceGesture(string key, bool down) {
        string action; if (!workspaceBindings.TryGetValue(key, out action)) return false;
        bool was = workspaceHeld.Contains(key), owned = was || down;
        if (was != down) { if (down) workspaceHeld.Add(key); else workspaceHeld.Remove(key); Output(new Dictionary<string, object> { { "event", "shortcut" }, { "action", action }, { "key", key }, { "pressed", down } }); }
        return owned;
    }
    static IntPtr WorkspaceKey(int code, IntPtr message, IntPtr data) {
        if (code >= 0) {
            var value = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(data, typeof(KBDLLHOOKSTRUCT));
            if ((value.flags & 0x10) == 0) {
                int kind = message.ToInt32(); bool down = kind == 0x100 || kind == 0x104, up = kind == 0x101 || kind == 0x105;
                string key = value.vkCode == 0xA5 ? "rightalt" : value.vkCode == 0xA3 ? "rightctrl" : "";
                if ((down || up) && WorkspaceGesture(key, down)) return new IntPtr(1);
                if (displayKeys && down) {
                    string label = value.vkCode == 13 ? "Enter" : value.vkCode == 9 ? "Tab" : value.vkCode == 32 ? "Space" : value.vkCode == 8 ? "Delete" : value.vkCode == 27 ? "Esc" : value.vkCode >= 37 && value.vkCode <= 40 ? "Arrow" : null;
                    if (label == null && ((GetAsyncKeyState(0x11) & 0x8000) != 0)) label = "Ctrl + Key";
                    if (label != null) Output(new Dictionary<string, object> { { "event", "capture-key" }, { "label", label } });
                }
            }
        }
        return CallNextHookEx(workspaceKeyHook, code, message, data);
    }
    static IntPtr WorkspaceMouse(int code, IntPtr message, IntPtr data) {
        if (code >= 0) {
            var value = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(data, typeof(MSLLHOOKSTRUCT)); int kind = message.ToInt32();
            if ((value.flags & 1) == 0 && (kind == 0x207 || kind == 0x208 || kind == 0x20B || kind == 0x20C)) {
                string key = kind == 0x207 || kind == 0x208 ? "mouse-middle" : (value.mouseData >> 16) == 1 ? "mouse-back" : "mouse-forward";
                if (WorkspaceGesture(key, kind == 0x207 || kind == 0x20B)) return new IntPtr(1);
            }
        }
        return CallNextHookEx(workspaceMouseHook, code, message, data);
    }
    static void ClearWorkspace() {
        foreach (string key in workspaceHeld) Output(new Dictionary<string, object> { { "event", "shortcut" }, { "action", workspaceBindings[key] }, { "key", key }, { "pressed", false } });
        workspaceHeld.Clear();
        if (workspaceKeyHook != IntPtr.Zero) UnhookWindowsHookEx(workspaceKeyHook); if (workspaceMouseHook != IntPtr.Zero) UnhookWindowsHookEx(workspaceMouseHook);
        workspaceKeyHook = IntPtr.Zero; workspaceMouseHook = IntPtr.Zero;
    }
    static Dictionary<string, object> WorkspaceWatch(Dictionary<string, object> request) {
        var next = new Dictionary<string, string>(); object raw;
        if (request.TryGetValue("bindings", out raw)) foreach (var pair in (Dictionary<string, object>)raw) {
            string action = Convert.ToString(pair.Value);
            if (!new[] { "rightalt", "rightctrl", "mouse-middle", "mouse-back", "mouse-forward" }.Contains(pair.Key) || !new[] { "hold", "dictation", "meeting", "overlay", "capture", "clipboard" }.Contains(action)) return Result(false, "快捷键无效。");
            next[pair.Key] = action;
        }
        Dictionary<string, object> result = null;
        using (var done = new ManualResetEvent(false)) {
            hookActions.Enqueue(() => {
                try {
                    ClearWorkspace(); workspaceBindings = next; displayKeys = request.ContainsKey("keys") && Convert.ToBoolean(request["keys"]);
                    if (displayKeys || next.Keys.Any(x => !x.StartsWith("mouse-"))) workspaceKeyHook = SetWindowsHookEx(13, workspaceKeyProc, GetModuleHandle(null), 0);
                    if (next.Keys.Any(x => x.StartsWith("mouse-"))) workspaceMouseHook = SetWindowsHookEx(14, workspaceMouseProc, GetModuleHandle(null), 0);
                    bool available = (!displayKeys && !next.Keys.Any(x => !x.StartsWith("mouse-")) || workspaceKeyHook != IntPtr.Zero) && (!next.Keys.Any(x => x.StartsWith("mouse-")) || workspaceMouseHook != IntPtr.Zero);
                    if (!available) ClearWorkspace(); result = new Dictionary<string, object> { { "ok", available }, { "available", available }, { "message", available ? "快捷键已就绪" : "快捷键监听失败。" } };
                } catch { ClearWorkspace(); result = Result(false, "快捷键监听失败。"); }
                finally { done.Set(); }
            });
            if (!PostThreadMessage(hookThreadId, ConfigureMessage, UIntPtr.Zero, IntPtr.Zero)) return Result(false, "快捷键线程不可用。");
            done.WaitOne();
        }
        return result;
    }

    // Read-only Windows Core Audio session enumeration; no microphone capture.
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class DeviceEnumeratorObject { }
    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface DeviceEnumerator { [PreserveSig] int EnumAudioEndpoints(int flow, uint mask, out DeviceCollection devices); }
    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface DeviceCollection { [PreserveSig] int GetCount(out uint count); [PreserveSig] int Item(uint index, out AudioDevice device); }
    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface AudioDevice { [PreserveSig] int Activate(ref Guid iid, uint context, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object value); }
    [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface AudioManager { [PreserveSig] int GetAudioSessionControl(IntPtr guid, uint flags, out IntPtr value); [PreserveSig] int GetSimpleAudioVolume(IntPtr guid, uint flags, out IntPtr value); [PreserveSig] int GetSessionEnumerator(out SessionEnumerator value); }
    [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface SessionEnumerator { [PreserveSig] int GetCount(out int count); [PreserveSig] int GetSession(int index, [MarshalAs(UnmanagedType.IUnknown)] out object control); }
    [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface SessionControl {
        [PreserveSig] int GetState(out int state); [PreserveSig] int GetDisplayName(out IntPtr value); [PreserveSig] int SetDisplayName(IntPtr value, IntPtr context); [PreserveSig] int GetIconPath(out IntPtr value); [PreserveSig] int SetIconPath(IntPtr value, IntPtr context); [PreserveSig] int GetGroupingParam(out Guid value); [PreserveSig] int SetGroupingParam(IntPtr value, IntPtr context); [PreserveSig] int RegisterAudioSessionNotification(IntPtr value); [PreserveSig] int UnregisterAudioSessionNotification(IntPtr value); [PreserveSig] int GetSessionIdentifier(out IntPtr value); [PreserveSig] int GetSessionInstanceIdentifier(out IntPtr value); [PreserveSig] int GetProcessId(out uint pid);
    }
    static void ReleaseCom(object value) { if (value != null && Marshal.IsComObject(value)) Marshal.ReleaseComObject(value); }
    static Dictionary<string, object> MicrophoneClients() {
        var clients = new List<Dictionary<string, object>>(); DeviceEnumerator enumerator = null; DeviceCollection devices = null;
        try {
            enumerator = (DeviceEnumerator)new DeviceEnumeratorObject(); Marshal.ThrowExceptionForHR(enumerator.EnumAudioEndpoints(1, 1, out devices)); uint count; Marshal.ThrowExceptionForHR(devices.GetCount(out count));
            for (uint i = 0; i < count; i++) {
                AudioDevice device = null; object managerObject = null; SessionEnumerator sessions = null;
                try {
                    Marshal.ThrowExceptionForHR(devices.Item(i, out device)); Guid iid = typeof(AudioManager).GUID; Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out managerObject));
                    var manager = (AudioManager)managerObject; Marshal.ThrowExceptionForHR(manager.GetSessionEnumerator(out sessions)); int length; Marshal.ThrowExceptionForHR(sessions.GetCount(out length));
                    for (int index = 0; index < length; index++) {
                        object controlObject = null;
                        try { Marshal.ThrowExceptionForHR(sessions.GetSession(index, out controlObject)); var control = (SessionControl)controlObject; int state; uint pid; if (control.GetState(out state) >= 0 && state == 1 && control.GetProcessId(out pid) >= 0 && pid > 0) { using (var process = System.Diagnostics.Process.GetProcessById((int)pid)) clients.Add(new Dictionary<string, object> { { "pid", pid }, { "name", process.ProcessName }, { "bundle", "" } }); } }
                        catch { /* A session can end while it is being enumerated. */ } finally { ReleaseCom(controlObject); }
                    }
                } catch { } finally { ReleaseCom(sessions); ReleaseCom(managerObject); ReleaseCom(device); }
            }
            return new Dictionary<string, object> { { "ok", true }, { "available", true }, { "clients", clients } };
        } catch { return new Dictionary<string, object> { { "ok", false }, { "available", false }, { "message", "无法读取应用音频状态，可手动开始会议。" } }; }
        finally { ReleaseCom(devices); ReleaseCom(enumerator); }
    }

    static AutomationElement target;
    static IntPtr window;
    static int[] runtimeId;
    static TextPatternRange selected;
    static readonly JavaScriptSerializer json = new JavaScriptSerializer();
    static Dictionary<string, object> Result(bool ok, string message = null, int sent = 0) {
        var r = new Dictionary<string, object> { { "ok", ok }, { "sent", sent } };
        if (message != null) r[ok ? "message" : "error"] = message;
        return r;
    }
    static bool Editable(AutomationElement e) {
        if (e == null || e.Current.IsPassword || !e.Current.IsEnabled || !e.Current.IsKeyboardFocusable) return false;
        if (e.Current.ControlType != ControlType.Edit && e.Current.ControlType != ControlType.Document && e.Current.ControlType != ControlType.ComboBox) return false;
        object pattern;
        if (e.TryGetCurrentPattern(ValuePattern.Pattern, out pattern) && ((ValuePattern)pattern).Current.IsReadOnly) return false;
        return true;
    }
    static TextPatternRange Selection(AutomationElement e) {
        object pattern;
        if (!e.TryGetCurrentPattern(TextPattern.Pattern, out pattern)) return null;
        var ranges = ((TextPattern)pattern).GetSelection();
        return ranges.Length == 1 ? ranges[0].Clone() : null;
    }
    static bool Matches() {
        var focused = AutomationElement.FocusedElement;
        return GetForegroundWindow() == window && Editable(focused) && runtimeId.SequenceEqual(focused.GetRuntimeId());
    }
    [DllImport("user32.dll")] static extern uint GetClipboardSequenceNumber();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
    static bool Modifiers() { return new[] { 0x10, 0x11, 0x12, 0x5B, 0x5C }.Any(key => (GetAsyncKeyState(key) & 0x8000) != 0); }
    static Dictionary<string, object> Handle(Dictionary<string, object> r) {
        string op = Convert.ToString(r["op"]);
        if (op == "microphone-clients") return MicrophoneClients();
        if (op == "workspace-watch") return WorkspaceWatch(r);
        if (op == "clipboard-sequence") return new Dictionary<string, object> { { "ok", true }, { "sequence", GetClipboardSequenceNumber() } };
        if (op == "watch") return Watch(r.ContainsKey("key") ? Convert.ToString(r["key"]) : "off");
        if (op == "status") return new Dictionary<string, object> { { "ok", true }, { "available", true }, { "message", "支持普通文字输入框；管理员窗口和部分应用可能限制输入。" } };
        if (op == "clear") { target = null; selected = null; return Result(true); }
        if (op == "capture") {
            target = null; selected = null;
            var foreground = GetForegroundWindow(); uint pid; GetWindowThreadProcessId(foreground, out pid);
            var focused = AutomationElement.FocusedElement;
            if (pid == Convert.ToUInt32(r["excludePid"]) || !Editable(focused)) return Result(false, "请先点击其他应用的普通文字输入框；当前目标不支持自动输入。");
            var id = focused.GetRuntimeId(); if (id == null || id.Length == 0) return Result(false, "无法确认输入框，文字将保留供复制。");
            target = focused; window = foreground; runtimeId = id; selected = Selection(focused);
            return new Dictionary<string, object> { { "ok", true }, { "appName", System.Diagnostics.Process.GetProcessById((int)pid).ProcessName } };
        }
        if ((op != "insert" && op != "paste") || target == null) return Result(false, "原输入框已失效，请复制文字后手动粘贴。");
        int sent = 0;
        try {
            string text = r.ContainsKey("text") ? Convert.ToString(r["text"]) : "";
            if (op != "paste" && (String.IsNullOrEmpty(text) || text.Length > 20000 || text.Any(Char.IsControl))) return Result(false, "输入文字无效或过长。");
            DateTime deadline = DateTime.UtcNow.AddSeconds(1.5);
            while (Modifiers() && DateTime.UtcNow < deadline) Thread.Sleep(20);
            if (Modifiers()) return Result(false, "快捷键仍被按住，请松开后手动复制文字。");
            if (op == "paste") { if (!Editable(target) || !SetForegroundWindow(window)) return Result(false, "无法恢复原输入窗口，请手动粘贴。"); target.SetFocus(); Thread.Sleep(100); }
            if (!Matches()) return Result(false, "焦点已离开原输入框，未自动输入；文字已保留。");
            var now = Selection(target);
            if (selected != null && now != null && (selected.CompareEndpoints(TextPatternRangeEndpoint.Start, now, TextPatternRangeEndpoint.Start) != 0 || selected.CompareEndpoints(TextPatternRangeEndpoint.End, now, TextPatternRangeEndpoint.End) != 0)) return Result(false, "输入位置已改变，未自动输入；文字已保留。");
            if (op == "paste") {
                var keys = new INPUT[4]; for (int i = 0; i < keys.Length; i++) keys[i].type = 1;
                keys[0].data.keyboard.vk = 0x11; keys[1].data.keyboard.vk = 0x56;
                keys[2] = keys[1]; keys[2].data.keyboard.flags = 2; keys[3] = keys[0]; keys[3].data.keyboard.flags = 2;
                uint count = SendInput(4, keys, Marshal.SizeOf(typeof(INPUT)));
                return new Dictionary<string, object> { { "ok", count == 4 }, { "verified", false }, { "error", "请检查目标输入框，避免重复粘贴。" } };
            }
            for (int offset = 0; offset < text.Length;) {
                if (!Matches() || Modifiers()) return Result(false, "输入途中焦点或键盘状态改变，已停止。请检查已输入部分，避免重复粘贴。", sent);
                int length = Math.Min(16, text.Length - offset);
                if (offset + length < text.Length && Char.IsHighSurrogate(text[offset + length - 1])) length--;
                var inputs = new INPUT[length * 2];
                for (int i = 0; i < length; i++) {
                    inputs[i * 2].type = 1; inputs[i * 2].data.keyboard.scan = text[offset + i]; inputs[i * 2].data.keyboard.flags = 4;
                    inputs[i * 2 + 1] = inputs[i * 2]; inputs[i * 2 + 1].data.keyboard.flags = 6;
                }
                uint count = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
                sent += (int)count / 2;
                if (count != inputs.Length) return Result(false, "Windows 或目标应用阻止了输入。请检查已输入部分；管理员窗口可能不受支持。", sent);
                offset += length; Thread.Sleep(12);
            }
            return new Dictionary<string, object> { { "ok", true }, { "method", "unicode" }, { "sent", sent } };
        } catch { return Result(false, "目标输入框不可用。请检查已输入部分；文字已保留。", sent); }
        finally { target = null; selected = null; }
    }
    [STAThread] public static void Main() {
        Console.InputEncoding = new System.Text.UTF8Encoding(false); Console.OutputEncoding = new System.Text.UTF8Encoding(false);
        var writer = new Thread(() => {
            var serializer = new JavaScriptSerializer();
            foreach (var item in outputs.GetConsumingEnumerable()) Console.WriteLine(serializer.Serialize(item));
        });
        writer.IsBackground = true; writer.Start();
        var listener = new Thread(HookLoop); listener.IsBackground = true; listener.Start(); hookReady.WaitOne();
        string line;
        while ((line = Console.ReadLine()) != null) {
            Dictionary<string, object> request = null; Dictionary<string, object> result;
            try { request = json.Deserialize<Dictionary<string, object>>(line); result = Handle(request); }
            catch { result = Result(false, "系统输入服务不可用，文字已保留供复制。"); }
            if (request != null && request.ContainsKey("id")) result["id"] = request["id"];
            Output(result);
        }
        Watch("off");
        PostThreadMessage(hookThreadId, 0x12, UIntPtr.Zero, IntPtr.Zero); // WM_QUIT
        listener.Join(2000);
        outputs.CompleteAdding(); writer.Join(2000);
    }
}
