const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LocalTranscriber } = require('../electron/local-speech.cjs');
const { DEFAULT_SETTINGS } = require('../electron/core.cjs');
const { SpeechSegments } = require('../electron/speech-segments.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
class Gate { constructor(options) { Object.assign(this, options); } async connect() {} async flush() {} dispose() {} }
function manager() {
  return { cacheDir: '', calls: [], async prepare() {}, dispose() {}, transcribeAudio(audio, _language, _dictionary, preview) { return new Promise(resolve => this.calls.push({ value: audio[0], preview, resolve })); } };
}
function setup(model = 'sensevoice') {
  const main = manager(), fast = manager(), updates = [];
  const client = new LocalTranscriber({ settings: { ...DEFAULT_SETTINGS, localModel: model, targetLanguage: 'off' }, manager: main, previewManager: fast, Gate, onSegment: row => updates.push(row), onFatal: assert.fail, onWarning: assert.fail });
  function feed(value, preview = true, segmentId = 1) { client.gate.onSegment({ audio: new Float32Array([value]), startMs: (segmentId - 1) * 10000, endMs: value * 1000, segmentId, preview }); }
  return { client, main, fast, updates, feed };
}
test('slow local decoding retains the newest queued preview, then the complete final', async () => {
  const { client, main, updates, feed } = setup(); await client.connect();
  feed(1); feed(2); feed(3);
  main.calls[0].resolve('早期'); await tick();
  assert.deepEqual(main.calls.map(x => x.value), [1, 3]);
  feed(4); feed(5, false); feed(6); // final removes preview 4 and rejects a stale preview 6
  main.calls[1].resolve('修订'); await tick();
  assert.deepEqual(main.calls.map(x => x.value), [1, 3, 5]);
  main.calls[2].resolve('最终文字'); await client.stop();
  assert.equal(updates.at(-1).text, '最终文字'); assert.equal(updates.at(-1).endMs, 5000); assert.ok(updates.at(-1).final);
});
test('enhanced final decoding does not block drafts and late drafts cannot overwrite finals', async () => {
  const { client, main, fast, updates, feed } = setup('ensemble'); await client.connect();
  feed(1); feed(2, false); feed(11, true, 2);
  assert.equal(main.calls.length, 1); assert.equal(fast.calls.length, 1);
  main.calls[0].resolve('已确认'); await tick();
  fast.calls[0].resolve('过时的第一句'); await tick();
  assert.equal(updates.filter(row => row.id === 'local-1').at(-1).text, '已确认');
  assert.equal(fast.calls[1].value, 11);
  fast.calls[1].resolve('第二句初稿'); await tick();
  feed(12, false, 2); main.calls[1].resolve('第二句定稿'); await client.stop();
  assert.ok(updates.some(row => row.text === '第二句初稿' && !row.final));
  assert.equal(updates.at(-1).text, '第二句定稿');
});
test('preview frequency never changes final PCM, boundaries or overlap', () => {
  function run(previewMs) {
    const finals = [], drafts = [], gate = new SpeechSegments({ previewMs, completeSentences: true, onSegment: x => finals.push(x), onPreview: x => drafts.push(x) });
    for (let i = 0; i < 1800; i++) gate.push(new Float32Array(512).fill(i), i % 500 < 460);
    gate.flush(); return { finals, drafts };
  }
  const old = run(4000), fast = run(800);
  assert.deepEqual(fast.finals, old.finals);
  assert.ok(fast.drafts[0].endMs <= 850); assert.ok(fast.drafts.length > old.drafts.length * 3);
});

test('a new sentence can show a draft while the previous sentence is still under review', async () => {
  const { client, main, fast, updates, feed } = setup('ensemble'); await client.connect();
  feed(1); fast.calls[0].resolve('第一句初稿'); await tick();
  feed(2, false); feed(11, true, 2); fast.calls[1].resolve('第二句正在说'); await tick();
  assert.ok(updates.some(x => x.text === '第二句正在说'));
  assert.equal(updates.filter(x => x.id === 'local-1').at(-1).final, false);
  main.calls[0].resolve('第一句复核完成'); await tick(); feed(12, false, 2); main.calls[1].resolve('第二句复核完成'); await client.stop();
});
test('VAD failure preserves a draft as incomplete and prevents post-stop mutation', async () => {
  const { client, main, updates, feed } = setup(); await client.connect();
  feed(1); main.calls[0].resolve('已经听到'); await tick();
  client.failed = true; await client.stop();
  assert.equal(updates.at(-1).text, '已经听到'); assert.ok(updates.at(-1).error); assert.ok(updates.at(-1).final);
  const count = updates.length; feed(2); assert.equal(updates.length, count);
});
