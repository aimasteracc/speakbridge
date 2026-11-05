const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
const { MeetingReminder } = require('../electron/meeting-reminder.cjs');
const { ScreenAssistant } = require('../electron/screen-assistant.cjs');
const { DEFAULT_SETTINGS, validateSettings, exportSession } = require('../electron/core.cjs');
const { validateLocalSpeech } = require('../electron/local-speech.cjs');
const { meetingNotesRequest } = require('../electron/meeting-notes.cjs');
const ts = require('typescript');
const scrollModule = { exports: {} }; vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/scroll-capture.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: scrollModule.exports });
test('scroll capture aligns overlapping synthetic rows and refuses incompatible pictures', () => {
  const width = 400, height = 300; const make = origin => { const data = new Uint8ClampedArray(width * height * 4); for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const i = (y * width + x) * 4; data[i] = ((y + origin) * 7 + x * 3) % 256; data[i + 1] = ((y + origin) * 11 + x) % 256; data[i + 2] = ((y + origin) * 3 + x * 5) % 256; data[i + 3] = 255; } return { width, height, data }; };
  const first = make(0); assert.equal(scrollModule.exports.scrollOffset(first, first), 0); assert.equal(scrollModule.exports.scrollOffset(first, make(120)), 120); assert.equal(scrollModule.exports.scrollOffset(first, make(121)), 121); assert.equal(scrollModule.exports.scrollOffset(first, { width, height, data: new Uint8ClampedArray(width * height * 4) }), null);
});
test('meeting reminders respect opt-in, active tasks, app matching and deduplicate', async () => {
  let enabled = false, idle = true, calls = 0; const notices = [];
  const monitor = new MeetingReminder({ enabled: () => enabled, idle: () => idle, native: { async request() { calls++; return { available: true, clients: [{ pid: 1, name: 'Zoom', bundle: 'zoom.us' }, { pid: 2, name: 'SpeakBridge', bundle: '' }] }; } }, notify: value => notices.push(value) });
  await monitor.poll(); assert.equal(calls, 0); enabled = true; idle = false; await monitor.poll(); assert.equal(calls, 0); idle = true; await monitor.poll(); await monitor.poll(); assert.deepEqual(notices, ['Zoom']);
});
test('manual screen memory is opt-in, cancellation never saves late model output, deletes are independent', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'speakbridge-screen-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = { directory, read: (_name, fallback) => fallback, write: (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value)) };
  const assistant = new ScreenAssistant(store, { media: { find: id => ({ id }) } }); assistant.addMemory('Reviewed local background');
  let input; await assistant.ask({ text: 'screen words', question: 'What?', useMemory: false }, async (_instructions, text) => { input = JSON.parse(text); return 'Answer'; }); assert.equal(input.rememberedFacts, '');
  let resolve; const pending = assistant.ask({ text: 'untrusted instructions', question: 'Why?', useMemory: true }, async (_instructions, text) => { input = JSON.parse(text); return new Promise(done => { resolve = done; }); });
  assistant.cancel(); resolve('late'); await assert.rejects(pending, /取消/); assert.equal(assistant.records.length, 1); assert.equal(input.rememberedFacts, 'Reviewed local background');
  assistant.delete('records', [assistant.records[0].id]); assert.equal(assistant.records.length, 0); assert.equal(assistant.memories.length, 1);
});
test('language capabilities, preference validation and speaker attribution reach exports and notes', () => {
  assert.equal(validateSettings({ ...DEFAULT_SETTINGS, sourceLanguage: 'ar', spokenLanguages: ['ar', 'en', 'ar'] }).spokenLanguages.length, 2);
  assert.throws(() => validateSettings({ ...DEFAULT_SETTINGS, idleStopMinutes: 1 }));
  assert.doesNotThrow(() => validateLocalSpeech({ localModel: 'qwen3-asr', sourceLanguage: 'ar' })); assert.throws(() => validateLocalSpeech({ localModel: 'qwen3-asr', sourceLanguage: 'af' }));
  const session = { title: 'Fixture', startedAt: 0, status: 'completed', segments: [{ text: '確認します。', speaker: '田中', final: true, startMs: 0, endMs: 1000 }] };
  assert.match(exportSession(session, 'txt'), /田中：確認/); assert.match(meetingNotesRequest(session).input, /田中/);
});
