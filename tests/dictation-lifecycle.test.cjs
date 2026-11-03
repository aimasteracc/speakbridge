const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { DEFAULT_SETTINGS } = require('../electron/core.cjs');
const dictation = require('../electron/dictation.cjs');

const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

// Run the actual controller with inert Electron/native/ASR dependencies. No
// window, microphone, helper process, keyboard event or user data is touched.
function controller({ captures = [], inserts = [], engineStop = async () => {}, cleanupProvider = 'off', generate = async () => '' } = {}) {
  const events = [], timers = new Map(), shortcuts = new Set(); let timerID = 0;
  const app = new EventEmitter();
  Object.assign(app, { isPackaged: true, setName() {}, requestSingleInstanceLock: () => true,
    whenReady: () => new Promise(() => {}), quit: () => events.push({ type: 'quit' }), exit: () => events.push({ type: 'exit' }) });
  const native = { request(op, fields) {
    events.push({ type: 'native', op, fields });
    if (op === 'capture') { assert.ok(captures.length, 'unexpected capture'); return captures.shift().promise; }
    if (op === 'insert') { assert.ok(inserts.length, 'unexpected insert'); return inserts.shift().promise; }
    return Promise.resolve({ ok: true, available: true });
  }, dispose() { events.push({ type: 'helper-killed' }); } };
  class LocalTranscriber { async connect() {} async stop() { await engineStop(); } }
  const electron = { app, systemPreferences: { getMediaAccessStatus: () => 'granted' }, globalShortcut: { register(key) { shortcuts.add(key); return true; }, unregister(key) { shortcuts.delete(key); }, isRegistered: key => shortcuts.has(key) } };
  const mainPath = path.resolve(__dirname, '../electron/main.cjs');
  const context = vm.createContext({ console, process, Buffer, AbortController, setImmediate,
    setTimeout(fn, ms) { const id = ++timerID; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); },
    __dirname: path.dirname(mainPath), __events: events, __native: native, __cleanupProvider: cleanupProvider, __settings: { ...DEFAULT_SETTINGS, speechProvider: 'local', targetLanguage: 'off' },
    require(name) {
      if (name === 'electron') return electron;
      if (name === './dictation.cjs') return dictation;
      if (name === './dictation-cleanup.cjs') return require('../electron/dictation-cleanup.cjs');
      if (name === './core.cjs') return require('../electron/core.cjs');
      if (name === './local-speech.cjs') return { LocalTranscriber, validateLocalSpeech() {} };
      if (name === './providers.cjs') return { detect: () => ({}), resolveEngines: () => ({ speech: 'local', text: 'off' }), TextRouter: class { generate(...args) { return generate(...args); } } };
      if (name.startsWith('./')) return {};
      return require(name);
    },
  });
  vm.runInContext(fs.readFileSync(mainPath, 'utf8') + `
    store = { settings: __settings, sessions: [] };
    whisper = { installed: () => true, ready: true, readyKey: 'sensevoice:auto' };
    nativeInput = __native; preferences = { holdKey: 'off', handsFreeShortcut: 'CommandOrControl+Shift+D', cleanupProvider: __cleanupProvider };
    mainWindow = { hide() { __events.push({ type: 'main-hide' }); }, show() { __events.push({ type: 'main-show' }); } };
    publish = (type, payload) => __events.push({ type, payload: payload === undefined ? undefined : JSON.parse(JSON.stringify(payload)) });
    showDictation = () => __events.push({ type: 'hud-show', phase: dictationFeedback?.phase });
    globalThis.testController = {
      toggleDictation, finishDictation, cancelDictation, stop, armInput, insertArmedInput, nativeEvent, clearDictationResult,
      startRecording: () => start({ dictationToken: dictationContext.token }),
      setWords: text => { current.segments = [{ text, final: true }]; },
      setInputReady: () => { inputAvailable = true; holdAvailable = true; },
      state: () => ({ status, current, dictationContext, dictationFeedback, armedInput, inputAvailable, holdAvailable, inputCommit: Boolean(inputCommit) }),
    };
  `, context, { filename: mainPath });
  return { api: context.testController, events, app, shortcuts, timers,
    writes: () => events.filter(event => event.type === 'native' && event.op === 'insert'),
    kills: () => events.filter(event => event.type === 'helper-killed') };
}

test('local cleanup runs between final recognition and insertion, and cancellation blocks late output', async () => {
  const capture = deferred(), generation = deferred(); let calls = 0;
  const c = controller({ captures: [capture], cleanupProvider: 'ollama', generate: async (_, input) => {
    calls++; assert.equal(JSON.parse(input).transcript, '嗯，明天讨论。'); return generation.promise;
  } });
  await c.api.toggleDictation(); await c.api.startRecording(); c.api.setWords('嗯，明天讨论。');
  capture.resolve({ ok: true, appName: '目标编辑器' });
  const stopping = c.api.stop(); await turn();
  assert.equal(calls, 1); assert.equal(c.api.state().dictationFeedback.phase, 'polishing'); assert.equal(c.writes().length, 0);
  c.api.cancelDictation(); await stopping;
  assert.equal(c.api.state().current.dictation.status, 'cancelled');
  generation.resolve('明天讨论。'); await turn(); assert.equal(c.writes().length, 0);
});

test('controller delivers the cleaned result once and keeps the original in memory', async () => {
  const capture = deferred(), insert = deferred();
  const c = controller({ captures: [capture], inserts: [insert], cleanupProvider: 'ollama', generate: async () => '明天讨论。' });
  await c.api.toggleDictation(); await c.api.startRecording(); c.api.setWords('嗯，明天讨论。');
  capture.resolve({ ok: true, appName: '目标编辑器' });
  const stopping = c.api.stop(); await turn();
  assert.deepEqual(c.writes().map(event => event.fields.text), ['明天讨论。']);
  insert.resolve({ ok: true, verified: true }); await stopping;
  const result = c.api.state().current.dictation;
  assert.equal(result.rawText, '嗯，明天讨论。'); assert.equal(result.cleanup.status, 'applied'); assert.equal(result.status, 'inserted');
});

test('slow target discovery does not delay HUD or recording; final delivery waits for that target', async () => {
  const capture = deferred(), insert = deferred(); const c = controller({ captures: [capture], inserts: [insert] });
  await c.api.toggleDictation();
  assert.ok(c.events.some(event => event.type === 'hud-show' && event.phase === 'preparing'));
  assert.ok(c.events.some(event => event.type === 'dictation-start'));
  await c.api.startRecording(); c.api.setWords('快捷键听写');
  const stopping = c.api.stop(); await turn();
  assert.equal(c.writes().length, 0); assert.equal(c.api.state().status, 'stopping');
  capture.resolve({ ok: true, appName: '目标编辑器', diagnostics: { stage: 'capture', code: 'ready', role: 'AXTextArea' } });
  await turn(); assert.equal(c.writes().length, 1); assert.equal(c.api.state().dictationFeedback.phase, 'inserting');
  assert.ok(c.events.some(event => event.type === 'dictation-feedback' && event.payload.targetName === '目标编辑器'));
  insert.resolve({ ok: true, verified: true }); await stopping;
  assert.equal(c.api.state().current.dictation.status, 'inserted');
  assert.equal(c.api.state().current.dictation.diagnostics.code, 'ready');
});

test('failed discovery keeps the real transcript for recovery instead of discarding the recording', async () => {
  const capture = deferred(); const c = controller({ captures: [capture] });
  await c.api.toggleDictation(); await c.api.startRecording(); c.api.setWords('保留已经说完的内容');
  capture.resolve({ ok: false, appName: '目标编辑器', error: '找不到输入框', diagnostics: { stage: 'capture', code: 'focus_unavailable' } });
  await c.api.stop();
  const result = c.api.state().current.dictation;
  assert.equal(result.status, 'retained'); assert.equal(result.text, '保留已经说完的内容');
  assert.equal(result.retryable, true); assert.equal(result.diagnostics.code, 'focus_unavailable'); assert.equal(c.writes().length, 0);
});

test('cancel while awaiting capture settles without its reply; an old reply cannot alter the next session', async () => {
  const oldCapture = deferred(), newCapture = deferred(), insert = deferred();
  const c = controller({ captures: [oldCapture, newCapture], inserts: [insert] });
  await c.api.toggleDictation(); await c.api.startRecording(); c.api.setWords('旧会话');
  const stopping = c.api.stop(); await turn(); c.api.cancelDictation(); await stopping;
  assert.equal(c.api.state().current.dictation.status, 'cancelled'); assert.equal(c.kills().length, 0);
  await c.api.toggleDictation(); await c.api.startRecording(); c.api.setWords('新会话');
  const eventCount = c.events.length;
  oldCapture.resolve({ ok: true, appName: '旧目标' }); await turn();
  assert.equal(c.events.length, eventCount); assert.notEqual(c.api.state().dictationFeedback.targetName, '旧目标');
  newCapture.resolve({ ok: true, appName: '新目标' });
  const secondStop = c.api.stop(); await turn();
  assert.equal(c.writes().length, 1); assert.equal(c.writes()[0].fields.text, '新会话');
  insert.resolve({ ok: true, verified: true }); await secondStop;
  assert.equal(c.api.state().current.dictation.targetName, '新目标');
});

test('atomic insertion ignores late cancel and interruption and waits before quitting', async () => {
  const capture = deferred(), insert = deferred(); const c = controller({ captures: [capture], inserts: [insert] });
  await c.api.toggleDictation(); await c.api.startRecording(); c.api.setWords('只输入一次');
  capture.resolve({ ok: true, appName: '目标编辑器' });
  const stopping = c.api.stop(); await turn();
  assert.equal(c.api.state().inputCommit, true); assert.equal(c.shortcuts.has('Escape'), false);
  c.api.cancelDictation(); c.api.finishDictation(); const interruption = c.api.stop('interrupted');
  let prevented = false; c.app.emit('before-quit', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(c.api.state().dictationFeedback.phase, 'inserting');
  assert.equal(c.kills().length, 0); assert.equal(c.events.some(event => event.type === 'quit'), false);
  insert.resolve({ ok: true, verified: true }); await Promise.all([stopping, interruption]); await turn();
  assert.equal(c.api.state().current.dictation.status, 'inserted'); assert.equal(c.writes().length, 1);
  assert.equal(c.kills().length, 0); assert.equal(c.events.some(event => event.type === 'quit'), true);
});

test('armed input shares cancellable discovery and atomic commit boundaries', async () => {
  const oldCapture = deferred(), capture = deferred(), insert = deferred();
  const c = controller({ captures: [oldCapture, capture], inserts: [insert] });
  c.api.armInput('test'); const cancelled = c.api.insertArmedInput(); c.api.cancelDictation(); await cancelled;
  assert.equal(c.api.state().current.dictation.status, 'cancelled'); assert.equal(c.writes().length, 0);
  c.api.armInput('test'); const pending = c.api.insertArmedInput();
  oldCapture.resolve({ ok: true, appName: '旧目标' });
  capture.resolve({ ok: true, appName: '测试输入框', diagnostics: { stage: 'capture', code: 'ready', role: 'AXTextArea' } });
  await turn(); assert.equal(c.api.state().dictationFeedback.phase, 'inserting'); c.api.cancelDictation();
  assert.equal(c.kills().length, 0); insert.resolve({ ok: true, verified: true }); await pending;
  assert.equal(c.api.state().current.dictation.status, 'inserted'); assert.equal(c.api.state().current.dictation.diagnostics.code, 'ready');
  assert.equal(c.writes().length, 1);
});

test('helper failure clears input readiness while a key-monitor failure does not', () => {
  const c = controller(); c.api.setInputReady();
  c.api.nativeEvent({ event: 'watch-error', message: '快捷键暂停' });
  assert.equal(c.api.state().inputAvailable, true); assert.equal(c.api.state().holdAvailable, false);
  c.api.nativeEvent({ event: 'helper-error', message: '系统输入组件不可用' });
  assert.equal(c.api.state().inputAvailable, false);
});

test('clear affects only the matching completed dictation and cannot interrupt an input transaction', async () => {
  const capture = deferred(), insert = deferred(); const c = controller({ captures: [capture], inserts: [insert] });
  c.api.armInput('test'); const work = c.api.insertArmedInput(); const id = c.api.state().current.id;
  assert.throws(() => c.api.clearDictationResult(id), /先结束/);
  capture.resolve({ ok: true }); await turn();
  assert.throws(() => c.api.clearDictationResult(id), /先结束/);
  insert.resolve({ ok: true, verified: true }); await work;
  assert.throws(() => c.api.clearDictationResult([id]), /不存在/);
  assert.throws(() => c.api.clearDictationResult('old-id'), /不存在/);
  assert.equal(c.api.state().current.id, id);
  assert.equal(c.api.clearDictationResult(id), true); assert.equal(c.api.state().current, null);
  assert.equal(c.api.state().dictationFeedback.targetName, ''); assert.equal(c.api.state().dictationFeedback.message, '');
  assert.equal(c.writes().length, 1); assert.equal(c.kills().length, 0);
});
