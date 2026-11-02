// Offline comparison of the exact old RMS/8s/Whisper path and new native VAD path.
// Corpus selection is fixed before inference; no reference text enters a model.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { WhisperManager, LocalTranscriber } = require('../electron/local-speech.cjs');
const { DEFAULT_SETTINGS, VoiceGate } = require('../electron/core.cjs');
const root = path.resolve(__dirname, '../test-artifacts/asr-quality');
const corpus = JSON.parse(fs.readFileSync(path.join(root, 'corpus.json')));
const cache = path.resolve(__dirname, '../test-artifacts/models');
const normalize = text => Array.from(text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''));
function score(reference, text) {
  const a = normalize(reference), b = normalize(text); let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { const next = [i]; for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = next; }
  return { errors: prev[b.length], characters: a.length, cer: prev[b.length] / a.length };
}
async function baseline(manager, pcm, language) {
  const chunks = [], jobs = []; let buffers = [];
  const gate = new VoiceGate({ onAudio: b => buffers.push(b), onCommit: bounds => { chunks.push(bounds); jobs.push(Buffer.concat(buffers)); buffers = []; } });
  for (let i = 0; i < pcm.length; i += 4800) gate.push(pcm.subarray(i, i + 4800)); gate.flush();
  const start = performance.now(), text = [];
  for (const audio of jobs) text.push(await manager.transcribe(audio, language));
  return { text: text.join(' '), segments: chunks.length, elapsedMs: performance.now() - start };
}
async function improved(manager, pcm, language, model = 'sensevoice') {
  const rows = new Map(), errors = [];
  const engine = new LocalTranscriber({ manager, settings: { ...DEFAULT_SETTINGS, localModel: model, sourceLanguage: language, targetLanguage: 'off' },
    translateText: async () => '', onSegment: row => rows.set(row.id, row), onFatal: error => errors.push(error), onWarning: error => errors.push(error) });
  await engine.connect(); const start = performance.now();
  for (let i = 0; i < pcm.length; i += 4800) engine.push(pcm.subarray(i, i + 4800));
  await engine.stop(); assert.deepEqual(errors, []);
  return { text: [...rows.values()].map(row => row.text).join(' '), segments: rows.size, elapsedMs: performance.now() - start, forcedSplits: [...rows.values()].filter(r => r.forced).length };
}
(async () => {
  const old = new WhisperManager(cache), current = new WhisperManager(cache), results = [];
  try {
    await old.prepare(false, 'whisper-base');
    for (const item of corpus.rows) {
      const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(root, item.file), '-f', 's16le', '-ac', '1', '-ar', '24000', 'pipe:1']);
      const before = await baseline(old, pcm, item.language), after = await improved(current, pcm, item.language);
      const row = { ...item, durationSec: pcm.length / 48000, before: { ...before, ...score(item.reference, before.text) }, after: { ...after, ...score(item.reference, after.text) } };
      results.push(row); console.log(item.language, item.file, 'CER', row.before.cer.toFixed(3), '->', row.after.cer.toFixed(3), 'RTF', (after.elapsedMs / 1000 / row.durationSec).toFixed(3));
      fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ dataset: corpus.dataset, revision: corpus.revision, results }, null, 2));
    }
    const silent = await improved(current, Buffer.alloc(48000 * 3), 'zh'); assert.equal(silent.text, '');
    const noise = Buffer.alloc(48000 * 3); let seed = 17;
    for (let i = 0; i < noise.length; i += 2) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; noise.writeInt16LE(Math.round((seed / 2 ** 32 - .5) * 8000), i); }
    const noiseResult = await improved(current, noise, 'zh'); assert.equal(noiseResult.text, '');
    const summary = {};
    for (const language of ['zh', 'ja']) {
      const rows = results.filter(row => row.language === language), chars = rows.reduce((n, r) => n + r.before.characters, 0), duration = rows.reduce((n, r) => n + r.durationSec, 0);
      summary[language] = { clips: rows.length, durationSec: duration, characters: chars,
        oldCER: rows.reduce((n, r) => n + r.before.errors, 0) / chars, newCER: rows.reduce((n, r) => n + r.after.errors, 0) / chars,
        newRTF: rows.reduce((n, r) => n + r.after.elapsedMs, 0) / 1000 / duration };
      assert.ok(summary[language].newCER < summary[language].oldCER, 'Recognition must improve on the fixed ' + language + ' corpus');
    }
    fs.writeFileSync(path.join(root, 'summary.json'), JSON.stringify({ date: new Date().toISOString(), summary, silence: silent, noise: noiseResult, limits: '16 public read-speech clips; no original-app service comparison, live microphone, room-noise or Windows hardware measurement. RTF excludes model loading and text translation.' }, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  } finally { old.dispose(); current.dispose(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
