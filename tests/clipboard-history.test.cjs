const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ClipboardHistory } = require('../electron/clipboard-history.cjs');
class Item { constructor(parts) { this.parts = parts; this.types = Object.keys(parts); } async getType(type) { const value = this.parts[type]; return typeof value === 'string' ? new Blob([value]) : value; } }
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'speakbridge-clips-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = { directory, read(name, fallback) { try { return JSON.parse(fs.readFileSync(path.join(directory, name))); } catch { return fallback; } }, write(name, value) { fs.writeFileSync(path.join(directory, name), JSON.stringify(value)); } };
  let counter = 1, entries = [], reads = 0, blocked = false;
  const clipboard = { async read() { reads++; return entries; }, async write(value) { entries = value; counter++; } };
  const options = { clipboard, ClipboardItem: Item, sequence: async () => counter, blocked: () => blocked };
  const library = new ClipboardHistory(store, options);
  return { library, store, options, clipboard, copied(parts) { entries = [new Item(parts)]; counter++; }, get reads() { return reads; }, set blocked(value) { blocked = value; } };
}
test('clipboard starts off, ignores initial/private/transient content and blocked dictation changes', async t => {
  const f = fixture(t); f.copied({ 'text/plain': 'before enabled' }); await f.library.poll(); assert.equal(f.reads, 0);
  await f.library.configure(true); await f.library.poll(); assert.equal(f.reads, 0);
  f.copied({ 'text/plain': 'private', 'electron application/osclipboard;format="org.nspasteboard.TransientType"': '' }); await f.library.poll(); assert.equal(f.library.list().length, 0);
  f.blocked = true; f.copied({ 'text/plain': 'during dictation' }); await f.library.poll(); f.blocked = false; await f.library.poll(); assert.equal(f.library.list().length, 0);
  f.copied({ 'text/plain': 'after enabled' }); await f.library.poll(); assert.equal(f.library.list()[0].text, 'after enabled');
});
test('original binary and rich formats round trip, restart, self-copy suppression and atomic delete validation', async t => {
  const f = fixture(t); await f.library.configure(true);
  const rich = { 'text/plain': '日本語与中文', 'text/html': '<b>日本語与中文</b>', 'electron application/osclipboard;format="sample"': new Blob([new Uint8Array([0, 1, 255])]) };
  f.copied(rich); await f.library.poll(); const [item] = f.library.list(); assert.equal(item.kind, 'rich');
  await f.library.copy(item.id); const copy = (await f.clipboard.read())[0]; assert.deepEqual([...new Uint8Array(await (await copy.getType(Object.keys(rich)[2])).arrayBuffer())], [0, 1, 255]);
  await f.library.poll(); assert.equal(f.library.list().length, 1);
  assert.equal(new ClipboardHistory(f.store, f.options).list()[0].id, item.id);
  assert.throws(() => f.library.delete([item.id, 'missing'])); assert.equal(f.library.list().length, 1);
  f.library.delete([item.id]); assert.deepEqual(f.library.list(), []); assert.equal(await (await copy.getType('text/html')).text(), '<b>日本語与中文</b>');
});

test('deletion invalidates a poll waiting for its final clipboard counter', async t => {
  const f = fixture(t); await f.library.configure(true); f.copied({ 'text/plain': 'existing' }); await f.library.poll();
  const id = f.library.list()[0].id; f.copied({ 'text/plain': 'pending' });
  const sequence = f.library.sequence; let calls = 0, release;
  f.library.sequence = async () => { if (++calls === 2) await new Promise(resolve => { release = resolve; }); return sequence(); };
  const polling = f.library.poll(); while (!release) await new Promise(resolve => setImmediate(resolve));
  f.library.delete([id]); release(); await polling; assert.equal(f.library.list().length, 0);
});
