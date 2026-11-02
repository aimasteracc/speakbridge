// Exercise actual LocalTranscriber -> session -> renderer/history, then native
// SenseVoice on a public recording. No user microphone or user data is used.
const { _electron: electron } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'), version = require('../package.json').version;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'speakbridge-cleanup-'));
let app;
(async () => {
  try {
    for (const folder of ['sensevoice', 'vad']) fs.cpSync(path.join(root, 'test-artifacts/models', folder), path.join(dir, 'models', folder), { recursive: true });
    const env = { ...process.env, SPEAKBRIDGE_DATA_DIR: dir }; delete env.ELECTRON_RUN_AS_NODE; delete env.SPEAKBRIDGE_DEV_URL;
    const executablePath = process.env.SPEAKBRIDGE_TEST_EXECUTABLE;
    app = await electron.launch({ ...(executablePath ? { executablePath, args: ['--user-data-dir=' + dir] } : { args: [root] }), env });
    assert.equal(fs.realpathSync(await app.evaluate(({ app }) => app.getPath('userData'))), fs.realpathSync(dir));
    const page = await app.firstWindow(); page.setDefaultTimeout(15000);
    await page.getByRole('heading', { name: '实时翻译', exact: true }).waitFor();
    await app.evaluate(({ app }) => {
      const require = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/electron/main.cjs');
      const { WhisperManager } = require('./local-speech.cjs'), { NeuralGate } = require('./neural-gate.cjs');
      const overrides = [[WhisperManager.prototype, 'prepare', async function () {}],
        [WhisperManager.prototype, 'transcribeAudio', async function (audio) { return { 1: '。', 2: '。', 3: '这个初稿随后被撤回', 4: '。', 5: '预算 3.14 万元。' }[audio[0]]; }],
        [NeuralGate.prototype, 'connect', async function () {}], [NeuralGate.prototype, 'flush', async function () {}],
        [NeuralGate.prototype, 'push', function (bytes) { const code = bytes[0], id = Math.ceil(code / 2); this.onSegment({ audio: new Float32Array([code]), startMs: id * 1000, endMs: id * 1000 + 500, segmentId: id, preview: code === 1 || code === 3 }); }]];
      const saved = overrides.map(([proto, key]) => [proto, key, proto[key]]);
      for (const [proto, key, fn] of overrides) proto[key] = fn;
      globalThis.__restoreCleanupFixtures = () => { for (const [proto, key, fn] of saved) proto[key] = fn; };
    });
    const settings = await page.evaluate(async () => {
      const b = await window.speakbridge.bootstrap();
      const s = await window.speakbridge.saveSettings({ ...b.settings, speechProvider: 'local', localModel: 'sensevoice', sourceLanguage: 'zh', targetLanguage: 'off' });
      await window.speakbridge.start({ demo: false, settings: s }); return s;
    });
    const send = async code => { await page.evaluate(code => window.speakbridge.audio(new Uint8Array([code, 0])), code); await page.waitForTimeout(80); };
    await send(1); await send(2);
    assert.equal(await page.locator('.transcript-row').count(), 0);
    await send(3); await page.getByText('这个初稿随后被撤回', { exact: true }).waitFor();
    await send(4); await page.waitForFunction(() => document.querySelectorAll('.transcript-row').length === 0);
    await send(5); await page.getByText('预算 3.14 万元。', { exact: true }).waitFor();
    const stopped = await page.evaluate(() => window.speakbridge.stop());
    assert.deepEqual(stopped.session.segments.map(row => row.text), ['预算 3.14 万元。']);
    const disk = JSON.parse(fs.readFileSync(path.join(dir, 'sessions.json')));
    assert.deepEqual(disk[0].segments.map(row => row.text), ['预算 3.14 万元。']);
    await app.evaluate(() => { globalThis.__restoreCleanupFixtures(); delete globalThis.__restoreCleanupFixtures; });
    console.log('PASS: local punctuation drafts/finals do not show or save; withdrawn text is removed');

    const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(root, 'test-artifacts/asr-quality/zh-10053956375630517392.wav'), '-f', 's16le', '-ac', '1', '-ar', '24000', 'pipe:1']);
    await page.evaluate(settings => window.speakbridge.start({ demo: false, settings }), settings);
    const native = await page.evaluate(async bytes => {
      const samples = [], drafts = [], pcm = Uint8Array.from(bytes), start = performance.now();
      let last = '', done = false;
      const watch = () => {
        const value = [...document.querySelectorAll('.original-text')].map(el => el.textContent).join('');
        if (value && value !== last) { samples.push({ text: value, elapsed: performance.now() - start }); last = value; }
        if (!done) requestAnimationFrame(watch);
      };
      const off = window.speakbridge.onEvent(e => {
        if (e.type === 'session') { const value = e.payload.session?.segments.map(r => r.text).join('') || ''; if (value && value !== drafts.at(-1)) drafts.push(value); }
      });
      requestAnimationFrame(watch);
      for (let i = 0; i < pcm.length; i += 4800) {
        const wait = start + i / 48 - performance.now(); if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
        window.speakbridge.audio(pcm.slice(i, i + 4800));
      }
      const state = await window.speakbridge.stop(); done = true; off();
      return { state, samples, draftCount: drafts.length };
    }, [...pcm]);
    const final = native.state.session.segments.map(row => row.text).join('');
    const baseline = JSON.parse(fs.readFileSync(path.join(root, 'test-artifacts/streaming-latency-0.5.0.json'))).find(r => r.model === 'sensevoice' && r.language === 'zh' && r.trial === 1);
    assert.equal(final, baseline.text);
    assert.ok(native.state.session.segments.every(row => row.final && !row.error));
    assert.ok(native.samples.length > native.draftCount, 'Actual ASR batches should produce more frequent visible output');
    const report = { version, packaged: !!executablePath, punctuationRowsSaved: 0, withdrawnDraftRemoved: true, nativeFinalUnchanged: true, final, visibleUpdates: native.samples.length, asrUpdates: native.draftCount, firstVisibleMs: Math.round(native.samples[0].elapsed), samples: native.samples, cloudRequests: 0, isolated: true };
    fs.writeFileSync(path.join(root, `test-artifacts/local-cleanup-${version}.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report, samples: undefined }));
  } finally { if (app) await app.close(); fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
