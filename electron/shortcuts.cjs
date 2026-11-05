const ACTIONS = ['hold', 'dictation', 'meeting', 'overlay', 'capture', 'clipboard'];
const NATIVE = ['fn', 'rightalt', 'rightctrl', 'mouse-middle', 'mouse-back', 'mouse-forward'];
function defaults(preferences) { return { hold: preferences.holdKey === 'off' ? [] : [preferences.holdKey], dictation: preferences.handsFreeShortcut === 'off' ? [] : [preferences.handsFreeShortcut], meeting: ['CommandOrControl+Shift+Space'], overlay: ['CommandOrControl+Shift+L'], capture: ['CommandOrControl+Shift+R'], clipboard: ['CommandOrControl+Shift+V'] }; }
function normalize(input, platform = process.platform) {
  if (!input || typeof input !== 'object' || Object.keys(input).some(x => !ACTIONS.includes(x))) throw new Error('快捷键设置无效。');
  const used = new Set(), next = {};
  for (const action of ACTIONS) {
    const keys = input[action];
    if (!Array.isArray(keys) || keys.length > 3) throw new Error('每个功能最多设置 3 个快捷键。');
    next[action] = keys.map(key => {
      if (typeof key !== 'string' || key.length > 90) throw new Error('快捷键格式无效。');
      if (NATIVE.includes(key)) { if ((key === 'fn' && platform !== 'darwin') || (action !== 'hold' && !key.startsWith('mouse-'))) throw new Error('这个按键只能用于按住说话。'); }
      else {
        if (action === 'hold') throw new Error('按住说话请选择独立修饰键或鼠标按钮。');
        const parts = key.split('+'), last = parts.pop(), mods = ['CommandOrControl', 'Alt', 'Shift'];
        if (!last || !/^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space)$/.test(last) || new Set(parts).size !== parts.length || parts.some(x => !mods.includes(x)) || (!parts.length && !last.startsWith('F'))) throw new Error('请使用组合键或 F1–F24。');
        key = [...mods.filter(x => parts.includes(x)), last].join('+');
        if (/^CommandOrControl\+(?:[ACVXZQW])$/.test(key) || key === 'Alt+F4') throw new Error('请避开系统编辑和关闭快捷键。');
      }
      if (used.has(key)) throw new Error('同一个快捷键不能分配给多个功能。'); used.add(key); return key;
    });
  }
  return next;
}
class Shortcuts {
  constructor(store, global, native, run, preferences) { Object.assign(this, { store, global, native, run }); this.bindings = normalize(store.read('shortcuts.json', defaults(preferences))); this.registered = new Map(); this.errors = []; this.nativeAvailable = false; }
  status() { return { bindings: this.bindings, errors: this.errors, nativeAvailable: this.nativeAvailable }; }
  nativeBindings(value = this.bindings) { return Object.fromEntries(ACTIONS.flatMap(action => value[action].filter(key => NATIVE.includes(key)).map(key => [key, action]))); }
  async refreshNative() { const result = await this.native.request('workspace-watch', { bindings: this.nativeBindings(), keys: this.showKeys === true }); this.nativeAvailable = result.ok === true && result.available === true; this.nativeMessage = result.error || result.message || ''; return result; }
  async initialize() {
    for (const action of ACTIONS) for (const key of this.bindings[action].filter(x => !NATIVE.includes(x))) {
      if (this.global.register(key, () => this.run(action, true))) this.registered.set(key, action); else this.errors.push(key + ' 已被其他应用占用');
    }
    await this.refreshNative(); return this.status();
  }
  async save(input) {
    const next = normalize(input), previous = this.bindings, old = new Map(this.registered), added = [];
    try {
      for (const action of ACTIONS) for (const key of next[action].filter(x => !NATIVE.includes(x))) {
        if (old.get(key) === action) continue;
        if (old.has(key)) { this.global.unregister(key); this.registered.delete(key); }
        if (!this.global.register(key, () => this.run(action, true))) throw new Error(key + ' 已被其他应用占用。');
        added.push(key); this.registered.set(key, action);
      }
      this.bindings = next; const result = await this.refreshNative();
      if (Object.keys(this.nativeBindings()).length && !result.available && JSON.stringify(this.nativeBindings(next)) !== JSON.stringify(this.nativeBindings(previous))) throw new Error(result.error || result.message || '请先完成辅助功能授权。');
      this.store.write('shortcuts.json', next);
      for (const [key] of old) if (!Object.values(next).some(keys => keys.includes(key))) { this.global.unregister(key); this.registered.delete(key); }
      this.errors = []; return this.status();
    } catch (error) {
      for (const key of added) { this.global.unregister(key); this.registered.delete(key); }
      this.bindings = previous;
      for (const [key, action] of old) if (!this.global.isRegistered(key)) { if (this.global.register(key, () => this.run(action, true))) this.registered.set(key, action); }
      await this.refreshNative().catch(() => {}); throw error;
    }
  }
}
module.exports = { Shortcuts, normalize, defaults, ACTIONS, NATIVE };
