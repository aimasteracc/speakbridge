const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SpeechSegments, trimOverlap } = require('../electron/speech-segments.cjs');
const { validateSettings } = require('../electron/core.cjs');
const { prepareAssets } = require('../electron/model-assets.cjs');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
function feed(gate, frames, speech, amplitude = 1) { for (let i = 0; i < frames; i++) gate.push(new Float32Array(512).fill(amplitude), speech); }
test('neural segmentation retains a twelve-second sentence instead of splitting at eight seconds', () => {
  const rows = [], gate = new SpeechSegments({ onSegment: r => rows.push(r) });
  feed(gate, 25, false, 0); feed(gate, 375, true); assert.equal(rows.length, 0);
  feed(gate, 25, false, 0); gate.flush();
  assert.equal(rows.length, 1); assert.equal(rows[0].forced, false);
  assert.ok(rows[0].audio.length / 16000 >= 12); assert.ok(rows[0].startMs < 800);
});
test('long continuous speech has bounded windows, one-second acoustic overlap and no missing samples', () => {
  const rows = [], gate = new SpeechSegments({ onSegment: r => rows.push(r) });
  for (let n = 0; n < 1700; n++) gate.push(Float32Array.from({ length: 512 }, (_, i) => n * 512 + i), true);
  gate.flush(); assert.ok(rows.length >= 3);
  for (let n = 1; n < rows.length; n++) {
    assert.equal(rows[n].overlap, true); assert.ok(rows[n - 1].forced);
    assert.equal(rows[n].startMs, rows[n - 1].endMs - 1000);
    assert.deepEqual(rows[n].audio.slice(0, 16000), rows[n - 1].audio.slice(-16000));
  }
  const samples = rows.reduce((sum, row) => sum + row.audio.length, 0) - 16000 * (rows.length - 1);
  assert.equal(samples, 1700 * 512); assert.equal(rows.at(-1).endMs, 1700 * 32);
});
test('silence emits nothing, stop flushes once, and pauses do not receive acoustic overlap', () => {
  const rows = [], gate = new SpeechSegments({ onSegment: r => rows.push(r) });
  feed(gate, 100, false); gate.flush(); assert.equal(rows.length, 0);
  feed(gate, 10, true); gate.flush(); gate.flush(); assert.equal(rows.length, 1);
  feed(gate, 10, true); feed(gate, 23, false); assert.equal(rows.length, 2); assert.equal(rows[1].overlap, false);
});
test('long utterances provide revisable previews without finalizing or losing their sentence identity', () => {
  const previews = [], finals = [], gate = new SpeechSegments({ onSegment: row => finals.push(row), onPreview: row => previews.push(row) });
  feed(gate, 375, true); assert.equal(finals.length, 0); assert.ok(previews.length >= 2);
  gate.flush(); assert.equal(finals.length, 1);
  assert.ok(previews.every(row => row.segmentId === finals[0].segmentId && row.preview));
  assert.ok(previews[0].endMs <= 4100); assert.ok(finals[0].audio.length > previews.at(-1).audio.length);
});
test('forced split survives transfer of the emitted audio buffer to another worker', () => {
  const rows = [], gate = new SpeechSegments({ onSegment: row => rows.push(structuredClone(row, { transfer: [row.audio.buffer] })) });
  feed(gate, 900, true); gate.flush(); assert.equal(rows.length, 2);
  assert.equal(rows[1].startMs, rows[0].endMs - 1000); assert.ok(rows[1].audio.length > 16000);
});
test('complete sentence mode preserves brief pauses in long sentences while providing previews', () => {
  const rows = [], previews = [], gate = new SpeechSegments({ completeSentences: true, silenceMs: 700, onSegment: row => rows.push(row), onPreview: row => previews.push(row) });
  feed(gate, 400, true); feed(gate, 10, false, 0); // 12.8 s speech, 320 ms pause
  assert.equal(rows.length, 0); assert.ok(previews.length >= 2);
  feed(gate, 100, true); feed(gate, 23, false, 0); // 736 ms still keeps the sentence
  assert.equal(rows.length, 0);
  feed(gate, 15, false, 0); assert.equal(rows.length, 1); assert.equal(rows[0].forced, false);
});
test('overlap dedup removes shared CJK and multiword English prefixes, preserving uncertain text', () => {
  assert.equal(trimOverlap('今天讨论语音识别', '语音识别的准确率。'), '的准确率。');
  assert.equal(trimOverlap('We support Windows and Mac.', 'Windows and Mac work well.'), 'work well.');
  assert.equal(trimOverlap('今日は日本語を', '日本語を話します。'), '話します。');
  assert.equal(trimOverlap('very', 'very good'), 'very good');
  assert.equal(trimOverlap('前一句', '不同的句子'), '不同的句子');
});
test('new and old settings select SenseVoice by default; invalid models and corrupt assets fail explicitly', async () => {
  assert.equal(validateSettings({}).localModel, 'sensevoice');
  assert.equal(validateSettings({ localModel: 'whisper-base' }).localModel, 'whisper-base');
  assert.throws(() => validateSettings({ localModel: '../outside' }));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'speech-assets-'));
  try { fs.mkdirSync(path.join(dir, 'vad')); fs.writeFileSync(path.join(dir, 'vad/silero_vad.onnx'), 'corrupt'); await assert.rejects(prepareAssets(dir, 'whisper-base', false), /校验失败/); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
