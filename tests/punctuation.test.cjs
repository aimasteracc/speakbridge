const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cleanSpeechText } = require('../electron/speech-text.cjs');
const { LocalTranscriber } = require('../electron/local-speech.cjs');
const { RealtimeTranscriber } = require('../electron/realtime.cjs');
const { SonioxTranscriber } = require('../electron/soniox.cjs');
const { DEFAULT_SETTINGS } = require('../electron/core.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('whole-hypothesis filter rejects punctuation only and preserves exact meaningful text', async () => {
  const { hasSpeechText } = await import('../src/text-motion.ts');
  for (const value of ['', '。', '。。。', ' . … , ! ? ', '「」！？', '\n。\u200B\uFEFF']) {
    assert.equal(cleanSpeechText(value), ''); assert.equal(hasSpeechText(value), false);
  }
  for (const value of ['嗯。', 'あ。', '네!', 'No.', '3.14', 'C++', '2026/11/01', '“你好。”', '等一下……', 'A。B。', '👩🏽‍💻', '+', '$10', '。这是完整句子。']) {
    assert.equal(cleanSpeechText(value), value); assert.equal(hasSpeechText(value), true);
  }
});
test('local punctuation guesses retract drafts, never flash pending rows or request translation', async () => {
  class Gate { constructor(options) { Object.assign(this, options); } async connect() {} async flush() {} dispose() {} }
  const updates = [], translations = [], results = ['。', '。', '暂时的猜测', '。', '预算 3.14 万元。'];
  const manager = { cacheDir: '', async prepare() {}, dispose() {}, async transcribeAudio() { return results.shift(); } };
  const client = new LocalTranscriber({ settings: { ...DEFAULT_SETTINGS, targetLanguage: 'en' }, manager, Gate,
    translateText: async text => { translations.push(text); return 'translation'; }, onSegment: row => updates.push(row), onFatal: assert.fail, onWarning: assert.fail });
  await client.connect();
  for (const [segmentId, preview] of [[1, true], [1, false], [2, true], [2, false], [3, false]]) {
    client.gate.onSegment({ audio: new Float32Array(10), startMs: segmentId * 1000, endMs: segmentId * 1000 + 500, segmentId, preview }); await tick();
  }
  await client.stop();
  assert.ok(updates.every(row => !row.pending && row.text !== '。'));
  const rows = new Map(updates.map(row => [row.id, row]));
  assert.equal(rows.get('local-1').text, ''); assert.equal(rows.get('local-2').text, '');
  assert.ok(rows.get('local-2').final); assert.equal(rows.get('local-3').text, '预算 3.14 万元。');
  assert.deepEqual(translations, ['预算 3.14 万元。']);
});
test('OpenAI deltas retain punctuation within a sentence but empty finals never translate', async () => {
  const updates = [], translations = [];
  const client = new RealtimeTranscriber({ settings: DEFAULT_SETTINGS, onSegment: row => updates.push(row), onFatal: assert.fail, onWarning: assert.fail,
    translateText: async text => { translations.push(text); return text; } });
  const send = (item_id, type, extra) => client.handle({ item_id, type: 'conversation.item.input_audio_transcription.' + type, ...extra });
  send('noise', 'delta', { delta: '。' }); send('noise', 'completed', { transcript: '。' });
  send('speech', 'delta', { delta: '“' }); send('speech', 'delta', { delta: '你好' }); send('speech', 'delta', { delta: '。”' });
  assert.equal(updates.at(-1).text, '“你好。”');
  send('speech', 'completed', { transcript: '“你好。”' }); await tick();
  assert.deepEqual(translations, ['“你好。”']); assert.ok(updates.filter(r => r.id === 'noise').every(r => !r.text));
});
test('Soniox final punctuation tokens remain attached while punctuation-only endpoints are empty', async () => {
  const updates = [], translations = [];
  const client = new SonioxTranscriber({ settings: DEFAULT_SETTINGS, onSegment: row => updates.push(row), onFatal: assert.fail, onWarning: assert.fail,
    translateText: async text => { translations.push(text); return text; } });
  const send = (text, final = true) => client.receive({ tokens: [{ text, is_final: final }] });
  send('。', false); send('。'); send('<end>');
  assert.equal(updates.at(-1).text, '');
  send('你好'); send('。'); assert.equal(updates.at(-1).text, '你好。'); send('<end>');
  await tick(); assert.deepEqual(translations, ['你好。']); await client.stop();
});
