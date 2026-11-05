const test = require('node:test');
const assert = require('node:assert/strict');
const { Shortcuts, normalize, defaults } = require('../electron/shortcuts.cjs');
const initial = () => defaults({ holdKey: 'off', handsFreeShortcut: 'CommandOrControl+Shift+D' });
test('shortcut limits, normalized collisions, reserved keys and mouse actions', () => {
  const bindings = initial(); bindings.dictation.push('mouse-middle', 'F8'); assert.equal(normalize(bindings).dictation.length, 3);
  bindings.dictation.push('F9'); assert.throws(() => normalize(bindings), /最多/);
  bindings.dictation = ['Shift+CommandOrControl+D']; bindings.meeting = ['CommandOrControl+Shift+D']; assert.throws(() => normalize(bindings), /同一个/);
  bindings.meeting = ['CommandOrControl+V']; assert.throws(() => normalize(bindings), /系统编辑/);
  bindings.meeting = ['Z']; assert.throws(() => normalize(bindings), /组合键/);
});
test('registration/native/storage failures restore the previous operational bindings', async () => {
  const registered = new Map(); let failNative = false, failDisk = false;
  const global = { register(key, fn) { if (key === 'F9' || registered.has(key)) return false; registered.set(key, fn); return true; }, unregister(key) { registered.delete(key); }, isRegistered(key) { return registered.has(key); } };
  const store = { read(_name, fallback) { return fallback; }, write() { if (failDisk) throw new Error('disk'); } };
  const native = { async request() { return { ok: !failNative, available: !failNative }; } };
  const manager = new Shortcuts(store, global, native, () => {}, { holdKey: 'off', handsFreeShortcut: 'CommandOrControl+Shift+D' }); await manager.initialize();
  const original = structuredClone(manager.bindings);
  for (const kind of ['register', 'native', 'disk']) {
    const next = structuredClone(original); next.dictation = ['F8', kind === 'register' ? 'F9' : 'mouse-middle'];
    failNative = kind === 'native'; failDisk = kind === 'disk'; await assert.rejects(manager.save(next));
    assert.deepEqual(manager.bindings, original); assert.equal(registered.has('F8'), false); assert.equal(registered.has(original.dictation[0]), true);
  }
});
