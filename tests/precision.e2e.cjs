// Real native inference and paced public audio through the Electron IPC/UI.
// Uses isolated data and no microphone, user audio, API key, or cloud service.
const { _electron: electron } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'speakbridge-precision-'));
let application;
(async () => {
  try {
    fs.symlinkSync(path.join(root, 'test-artifacts/models'), path.join(directory, 'models'), 'junction');
    const env = { ...process.env, SPEAKBRIDGE_DATA_DIR: directory }; delete env.ELECTRON_RUN_AS_NODE;
    const executablePath = process.env.SPEAKBRIDGE_TEST_EXECUTABLE;
    application = await electron.launch({ ...(executablePath ? { executablePath, args: ['--user-data-dir=' + directory] } : { args: [root] }), env });
    assert.equal(fs.realpathSync(await application.evaluate(({ app }) => app.getPath('userData'))), fs.realpathSync(directory), 'must never run test sessions against real user data');
    const page = await application.firstWindow(); page.setDefaultTimeout(30000);
    await page.getByRole('heading', { name: '实时翻译', exact: true }).waitFor();
    if(executablePath)assert.equal(await application.evaluate(({ app }) => app.isPackaged), true);
    const settings = await page.evaluate(async () => {
      const boot = await window.speakbridge.bootstrap();
      return window.speakbridge.saveSettings({ ...boot.settings, speechProvider: 'local', localModel: 'ensemble', sourceLanguage: 'zh', targetLanguage: 'off' });
    });
    const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(root, 'test-artifacts/asr-quality/zh-10053956375630517392.wav'), '-f', 's16le', '-ac', '1', '-ar', '24000', 'pipe:1']);
    await page.evaluate(settings => window.speakbridge.start({ demo: false, settings }), settings);
    const started = Date.now();
    const task = page.evaluate(async bytes => {
      window.__precisionUpdates = [];
      const off = window.speakbridge.onEvent(event => { if(event.type==='session')window.__precisionUpdates.push(event.payload.session?.segments || []); });
      const data = Uint8Array.from(bytes);
      for(let i=0;i<data.length;i+=4800){window.speakbridge.audio(data.slice(i,i+4800));await new Promise(resolve=>setTimeout(resolve,100));}
      const result = await window.speakbridge.stop();off();return result;
    }, [...pcm]);
    await page.waitForFunction(() => window.__precisionUpdates?.some(rows => rows.some(row => row.text && !row.final)));
    const firstPreviewMs = Date.now() - started;
    await page.locator('.transcript-row.partial .original-text').filter({ hasText: '博客' }).waitFor();
    await page.screenshot({ path: path.join(root, 'test-artifacts/0.5-ensemble-preview.png') });
    const ended = await task;
    const recordingElapsedMs = Date.now() - started;
    assert.ok(firstPreviewMs < 3500, 'fast draft should appear within 3.5 seconds for this fixed clip on the test machine');
    assert.equal(ended.session.speechModel, 'ensemble');
    assert.ok(ended.session.segments.every(row => row.final && !row.error));
    assert.ok(ended.session.segments.some(row => row.text.includes('博客')));
    const ensembleText = ended.session.segments.map(row => row.text).join('');
    await page.getByRole('button', { name: '查看会话', exact: true }).first().click();
    await page.getByRole('dialog').getByText(ensembleText, { exact: true }).waitFor();
    await page.screenshot({ path: path.join(root, 'test-artifacts/0.5-ensemble-transcript.png') });
    await page.keyboard.press('Escape');
    await assert.rejects(page.evaluate(settings => window.speakbridge.checkEngines({ ...settings, dictionary: ['语音'.repeat(30), '名字'.repeat(20)] }), settings), /256 字节/);
    await assert.rejects(page.evaluate(settings => window.speakbridge.checkEngines({ ...settings, sourceLanguage: 'fr' }), settings), /该语言/);
    // Observe real requests without replacing inference. A hint is not a forced
    // transcript substitution: this name is still missed after capture resampling.
    await application.evaluate(({ app }) => {
      const require = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/electron/main.cjs');
      const { WhisperManager } = require(app.getAppPath() + '/electron/local-speech.cjs');
      const original = WhisperManager.prototype.transcribeAudio;
      globalThis.__dictionaryCalls = [];
      WhisperManager.prototype.transcribeAudio = function(audio, language, dictionary, preview) {
        globalThis.__dictionaryCalls.push({ language, dictionary, preview, model: this.readyKey });
        return original.call(this, audio, language, dictionary, preview);
      };
    });
    const hinted = await page.evaluate(async ({ settings, bytes }) => {
      const s = await window.speakbridge.saveSettings({ ...settings, localModel: 'qwen3-asr', dictionary: ['Oravec'] });
      await window.speakbridge.start({ demo: false, settings: s });
      const data = Uint8Array.from(bytes);for(let i=0;i<data.length;i+=4800)window.speakbridge.audio(data.slice(i,i+4800));
      return window.speakbridge.stop();
    }, { settings, bytes: [...pcm] });
    const hotwordText = hinted.session.segments.map(row => row.text).join('');
    assert.ok(hotwordText.length > 0 && hinted.session.segments.every(row => row.final && !row.error));
    const dictionaryCalls = await application.evaluate(() => globalThis.__dictionaryCalls);
    assert.ok(dictionaryCalls.some(call => call.model.startsWith('qwen3-asr:') && !call.preview && call.language === 'zh' && call.dictionary?.join(',') === 'Oravec'));
    const silence = await page.evaluate(async settings => {
      await window.speakbridge.start({ demo: false, settings: { ...settings, localModel: 'ensemble' } });
      for(let i=0;i<30;i++)window.speakbridge.audio(new Uint8Array(4800));
      return window.speakbridge.stop();
    }, settings);
    assert.equal(silence.session.segments.filter(row => row.text).length, 0);
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByLabel('本地识别模型').selectOption('ensemble');
    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await page.getByText('设置已保存', { exact: true }).waitFor();
    assert.equal(await page.evaluate(async () => (await window.speakbridge.bootstrap()).settings.localModel), 'ensemble');
    await page.getByLabel('本地识别模型').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(root, 'test-artifacts/0.5-ensemble-settings.png') });
    const results = { passed: true, packaged: !!executablePath, firstPreviewMs, audioDurationMs: pcm.length/48, recordingElapsedMs, totalElapsedMs: Date.now()-started, ensembleText, hotwordText, dictionaryWired: true, hintedNameRecognized: /Oravec/i.test(hotwordText), dictionaryCalls, oversizeDictionaryRejected: true, silenceEmpty: true, modelSwitchSaved: true };
    fs.writeFileSync(path.join(root, 'test-artifacts/precision-e2e-0.5.0-result.json'), JSON.stringify(results, null, 2));
    console.log('PASS: enhanced model, paced previews, real hotword inference, silence and validation', firstPreviewMs, 'ms to first preview');
  } finally { if(application)await application.close();fs.rmSync(directory,{recursive:true,force:true}); }
})().catch(error=>{console.error(error);process.exitCode=1;});
