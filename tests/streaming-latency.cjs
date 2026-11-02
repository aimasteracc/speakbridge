// Real native inference, public speech paced at capture speed. No cloud or microphone.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const runtime = process.env.ASR_RUNTIME_ROOT || path.resolve(__dirname, '../electron');
const { WhisperManager, LocalTranscriber } = require(path.join(runtime, 'local-speech.cjs'));
const { DEFAULT_SETTINGS } = require(path.join(runtime, 'core.cjs'));
const root = path.resolve(__dirname, '..');
const label = process.env.ASR_OUTPUT_TAG || 'current';
const examples = [{ language: 'zh', file: 'zh-10053956375630517392.wav' }, { language: 'ja', file: 'ja-10086073819084529371.wav' }];
(async () => {
  const results = [], manager = new WhisperManager(path.join(root, 'test-artifacts/models'));
  try {
    for (const model of ['sensevoice', 'ensemble']) for (const example of examples) {
      const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(root, 'test-artifacts/asr-quality', example.file), '-f', 's16le', '-ac', '1', '-ar', '24000', 'pipe:1']);
      for (let trial = 1; trial <= 2; trial++) {
        const events = [], errors = []; let start = 0;
        const engine = new LocalTranscriber({ manager, settings: { ...DEFAULT_SETTINGS, localModel: model, sourceLanguage: example.language, targetLanguage: 'off' }, translateText: async () => '', onSegment: row => { if (start) events.push({ elapsedMs: performance.now() - start, ...row }); }, onFatal: x => errors.push(x), onWarning: x => errors.push(x) });
        await engine.connect(); start = performance.now();
        for (let i = 0; i < pcm.length; i += 4800) {
          const wait = start + i / 48 - performance.now(); if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
          engine.push(pcm.subarray(i, i + 4800));
        }
        const stopAtMs = performance.now() - start;
        await engine.stop(); assert.deepEqual(errors, []);
        const drafts = events.filter(e => e.text && !e.final);
        const finals = [...new Map(events.filter(e => e.final).map(e => [e.id, e])).values()];
        assert.ok(finals.length && finals.every(e => !e.error));
        const result = { label, model, ...example, trial, durationMs: pcm.length / 48, firstTextMs: events.find(e => e.text)?.elapsedMs, firstDraftMs: drafts[0]?.elapsedMs, draftCount: drafts.length, draftIntervalsMs: drafts.slice(1).map((e, i) => e.elapsedMs - drafts[i].elapsedMs), stopAtMs, stopDrainMs: performance.now() - start - stopAtMs, lastFinalMs: finals.at(-1).elapsedMs, text: finals.map(e => e.text).join(''), events };
        results.push(result); fs.writeFileSync(path.join(root, 'test-artifacts', `streaming-latency-${label}.json`), JSON.stringify(results, null, 2));
        console.log(JSON.stringify({ ...result, events: undefined, draftIntervalsMs: undefined }));
      }
    }
  } finally { manager.dispose(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
