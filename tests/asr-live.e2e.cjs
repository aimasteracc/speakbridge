const { _electron: electron } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'speakbridge-live-asr-'));
let app;
(async () => {
  try {
    for (const folder of ['sensevoice', 'vad']) fs.cpSync(path.join(root, 'test-artifacts/models', folder), path.join(dir, 'models', folder), { recursive: true });
    const env = { ...process.env, SPEAKBRIDGE_DATA_DIR: dir }; delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ args: [root], env });
    const page = await app.firstWindow(); page.setDefaultTimeout(15000);
    const settings = await page.evaluate(async () => { const b = await window.speakbridge.bootstrap(); const s = await window.speakbridge.saveSettings({ ...b.settings, speechProvider: 'local', localModel: 'sensevoice', sourceLanguage: 'zh', targetLanguage: 'off' }); await window.speakbridge.start({ demo: false, settings: s }); return s; });
    const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(root, 'test-artifacts/asr-quality/zh-10053956375630517392.wav'), '-f', 's16le', '-ac', '1', '-ar', '24000', 'pipe:1']);
    const start = Date.now();
    // Feed at the original capture cadence to exercise previews during ongoing speech.
    const task = page.evaluate(async bytes => {
      const pcm = Uint8Array.from(bytes); window.__asrUpdates = [];
      const off = window.speakbridge.onEvent(e => { if (e.type === 'session') window.__asrUpdates.push({ elapsed: performance.now(), rows: e.payload.session?.segments || [] }); });
      for (let i = 0; i < pcm.length; i += 4800) { window.speakbridge.audio(pcm.slice(i, i + 4800)); await new Promise(r => setTimeout(r, 100)); }
      const state = await window.speakbridge.stop(); off(); return { state, updates: window.__asrUpdates };
    }, [...pcm]);
    await page.waitForFunction(() => window.__asrUpdates?.some(event => event.rows.some(row => !row.final && row.text)));
    const firstPreviewMs = Date.now() - start;
    await page.screenshot({ path: path.join(root, 'test-artifacts/11-live-chinese-preview.png') });
    const result = await task;
    assert.ok(firstPreviewMs < pcm.length / 48, 'preview must appear before the recording ends');
    assert.ok(result.state.session.segments.every(row => row.final && !row.error));
    const texts = result.state.session.segments.map(row => row.text).join('');
    assert.ok(texts.length > 10); assert.equal(result.state.session.speechModel, 'sensevoice');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    assert.equal(await page.getByLabel('本地识别模型').inputValue(), 'sensevoice');
    await page.screenshot({ path: path.join(root, 'test-artifacts/12-sensevoice-settings.png') });
    await page.getByLabel('本地识别模型').selectOption('whisper-base');
    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await page.getByText('设置已保存', { exact: true }).waitFor();
    assert.equal(await page.evaluate(async () => (await window.speakbridge.bootstrap()).settings.localModel), 'whisper-base');
    assert.equal(await page.evaluate(async () => (await window.speakbridge.detectEngines()).localInstalled), false);
    await assert.rejects(page.evaluate(settings => window.speakbridge.checkEngines({ ...settings, localModel: 'sensevoice', sourceLanguage: 'fr' }), settings), /该语言/);
    fs.writeFileSync(path.join(root, 'test-artifacts/live-asr-result.json'), JSON.stringify({ passed: true, firstPreviewMs, inputDurationMs: pcm.length / 48, transcript: texts, finalSegments: result.state.session.segments.length, modelSwitchSaved: true }, null, 2));
    console.log('PASS: real Chinese audio paced through Electron IPC, live preview, final save, model selection and language validation', firstPreviewMs, 'ms to preview');
  } finally { if (app) await app.close(); fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
