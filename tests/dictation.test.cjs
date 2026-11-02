const test = require('node:test');
const assert = require('node:assert/strict');
const { dictationPreferences, dictationSettings, dictationText, deliverDictation, NativeInput } = require('../electron/dictation.cjs');
const { resolveEngines } = require('../electron/providers.cjs');
const { DEFAULT_SETTINGS } = require('../electron/core.cjs');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

test('hold and hands-free preferences validate independently for each OS', () => {
  assert.equal(dictationPreferences({}, 'darwin').holdKey, 'rightalt');
  assert.equal(dictationPreferences({ holdKey: 'fn' }, 'darwin').holdKey, 'fn', 'Explicit user choices survive upgrades');
  assert.equal(dictationPreferences({}, 'win32').holdKey, 'rightalt');
  assert.deepEqual(dictationPreferences({ holdKey: 'off', handsFreeShortcut: 'off' }), { holdKey: 'off', handsFreeShortcut: 'off' });
  assert.throws(() => dictationPreferences({ holdKey: 'fn' }, 'win32'), /快捷键/);
  assert.throws(() => dictationPreferences({ handsFreeShortcut: 'Control+A' }), /快捷键/);
});

test('dictation remains local with saved API credentials, cloud text engine and system capture settings', () => {
  const original = { ...DEFAULT_SETTINGS, speechProvider: 'api', textProvider: 'api', audioSource: 'both', targetLanguage: 'ja' };
  const settings = dictationSettings(original);
  assert.equal(settings.audioSource, 'microphone'); assert.equal(settings.targetLanguage, 'off');
  assert.deepEqual(resolveEngines(settings, 'synthetic-test-key', {}, false), { speech: 'local', text: 'off' });
  assert.equal(original.speechProvider, 'api'); assert.equal(original.audioSource, 'both');
});
test('only final meaningful speech is inserted; controls cannot send Enter or Tab', () => {
  assert.equal(dictationText([{ text: '。', final: true }, { text: '旧初稿', final: false }, { text: '错误内容', final: true, error: 'failed' }, { text: '你好👩🏽‍💻\nHello\t3.14\r\u001b!', final: true }]), '你好👩🏽‍💻 Hello 3.14 !');
});
test('cancelled, interrupted, incomplete and empty dictations never invoke native input', async () => {
  const native = { request() { assert.fail('must not insert'); } };
  const session = { segments: [{ text: '你好。', final: true }] };
  assert.equal((await deliverDictation(session, native, { cancelled: true }, 'completed')).status, 'cancelled');
  assert.equal((await deliverDictation(session, native, {}, 'interrupted')).status, 'retained');
  assert.equal((await deliverDictation({ segments: [{ text: '初稿', final: false }] }, native, {}, 'completed')).status, 'retained');
  assert.equal((await deliverDictation({ segments: [{ text: '。', final: true }] }, native, {}, 'completed')).status, 'empty');
  assert.equal((await deliverDictation(session, native, { targetError: 'permission denied' }, 'completed')).message, 'permission denied');
});
test('native failure and partial writes retain text without automatic retry', async () => {
  const session = { segments: [{ text: '你好', final: true }] }; let calls = 0;
  const native = { async request(op, value) { calls++; assert.equal(op, 'insert'); assert.equal(value.text, '你好'); return { ok: false, sent: 1, error: '焦点改变' }; } };
  const result = await deliverDictation(session, native, {}, 'completed');
  assert.equal(calls, 1); assert.equal(result.status, 'retained'); assert.equal(result.text, '你好');
  assert.equal((await deliverDictation(session, { request: async () => { throw Error('timeout'); } }, {}, 'completed')).message, 'timeout');
  assert.equal((await deliverDictation(session, { request: async () => ({ ok: true, method: 'accessibility' }) }, {}, 'completed')).status, 'inserted');
});
test('retry is available only when native input confirms zero characters sent', async () => {
  const session = { segments: [{ text: '保留这段文字', final: true }] };
  const failed = sent => deliverDictation(session, { request: async () => ({ ok: false, sent, error: '焦点改变' }) }, {}, 'completed');
  assert.equal((await failed(0)).retryable, true);
  assert.equal((await failed(1)).retryable, false);
  assert.equal((await failed(undefined)).retryable, false);
  assert.equal((await deliverDictation(session, { request: async () => { throw Error('timeout'); } }, {}, 'completed')).retryable, false);
  const result = await deliverDictation(session, { request: async () => ({ ok: true, method: 'clipboard', verified: false, sent: 6 }) }, {}, 'completed');
  assert.equal(result.status, 'sent'); assert.equal(result.retryable, false);
  assert.match(result.message, /检查输入框/);
});
test('native helper protocol transports speech on stdin and rejects all pending work on crash', async () => {
  let child, launchArgs; const events = [];
  const native = new NativeInput('/tmp', { onEvent: event => events.push(event), launch: (...args) => {
    launchArgs = args; child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.kill = () => {};
    return child;
  } });
  native.executable = async () => '/verified/helper';
  const pending = native.request('insert', { text: '测试 ` $(echo no) 👋' });
  await new Promise(resolve => setImmediate(resolve));
  const request = JSON.parse(child.stdin.read().toString());
  assert.equal(request.text, '测试 ` $(echo no) 👋'); assert.deepEqual(launchArgs[1], []); assert.equal(launchArgs[2].shell, false);
  child.stdout.write(JSON.stringify({ event: 'hold', pressed: true }) + '\n');
  assert.deepEqual(events, [{ event: 'hold', pressed: true }]); assert.equal(native.pending.size, 1);
  child.stdout.write(JSON.stringify({ id: request.id, ok: true }).slice(0, 5));
  child.stdout.write(JSON.stringify({ id: request.id, ok: true }).slice(5) + '\n');
  assert.equal((await pending).ok, true);
  const aborted = native.request('capture'); await new Promise(resolve => setImmediate(resolve)); child.emit('exit', 1);
  await assert.rejects(aborted, /已结束/); assert.equal(native.pending.size, 0);
  assert.equal(events.at(-1).event, 'helper-error'); assert.match(events.at(-1).message, /组件不可用/);
});
test('delivery waits for its own target and carries safe capture and insert diagnostics', async () => {
  let resolveCapture, writes = 0, commits = 0;
  const context = { capture: new Promise(resolve => { resolveCapture = resolve; }), onWillInsert: () => commits++ };
  const pending = deliverDictation({ segments: [{ text: '本次听写', final: true }] }, { request: async () => {
    writes++; return { ok: false, sent: 0, error: '输入位置改变', diagnostics: { stage: 'insert', code: 'selection_changed' } };
  } }, context, 'completed');
  await new Promise(resolve => setImmediate(resolve)); assert.equal(writes, 0); assert.equal(commits, 0);
  resolveCapture({ ok: true, appName: '测试编辑器', diagnostics: { stage: 'capture', code: 'ready', role: 'AXTextArea' } });
  const result = await pending;
  assert.equal(writes, 1); assert.equal(commits, 1); assert.equal(result.targetName, '测试编辑器');
  assert.deepEqual(result.diagnostics, { stage: 'insert', code: 'selection_changed' }); assert.equal(result.retryable, true);
});
test('failed target discovery retains completed speech without ever attempting input', async () => {
  const diagnostics = { stage: 'capture', code: 'focus_unavailable', role: 'AXGroup' };
  const result = await deliverDictation({ segments: [{ text: '已经说完的话', final: true }] }, { request: () => assert.fail('unknown target must not receive text') }, {
    capture: Promise.resolve({ ok: false, appName: '测试编辑器', error: '找不到编辑框', diagnostics }),
  }, 'completed');
  assert.equal(result.status, 'retained'); assert.equal(result.text, '已经说完的话'); assert.equal(result.retryable, true);
  assert.equal(result.targetName, '测试编辑器'); assert.deepEqual(result.diagnostics, diagnostics);
});
test('cancelled or superseded discovery cannot write after its delayed result arrives', async () => {
  let resolveCapture; const abort = new AbortController(); let current = true;
  const capture = new Promise(resolve => { resolveCapture = resolve; });
  const context = { capture, signal: abort.signal, isCurrent: () => current };
  const pending = deliverDictation({ segments: [{ text: '旧会话', final: true }] }, { request: () => assert.fail('stale target must not receive text') }, context, 'completed');
  abort.abort();
  assert.equal((await pending).status, 'cancelled');
  current = false; resolveCapture({ ok: true, appName: '旧目标' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await deliverDictation({ segments: [{ text: '旧会话', final: true }] }, { request: () => assert.fail('expired session') }, { capture, isCurrent: () => false }, 'completed')).status, 'cancelled');
});
