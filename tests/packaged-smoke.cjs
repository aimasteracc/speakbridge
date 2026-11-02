const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
(async () => {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const application = await electron.launch({ executablePath: path.join(root, 'release/0.3.0/mac-arm64/SpeakBridge.app/Contents/MacOS/SpeakBridge'), env, timeout: 30000 });
  try {
    const page = await application.firstWindow(); page.setDefaultTimeout(10000);
    await page.getByRole('heading', { name: '实时翻译', exact: true }).waitFor();
    const boot = await page.evaluate(() => window.speakbridge.bootstrap());
    assert.equal(boot.appVersion, '0.3.0'); assert.equal(boot.platform, 'darwin');
    assert.equal(await application.evaluate(({ app }) => app.isPackaged), true);
    assert.ok(page.url().includes('app.asar'));
    const localText = await application.evaluate(async ({ app }, root) => {
      const require = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/electron/main.cjs');
      const path = require('node:path'), fs = require('node:fs');
      const { WhisperManager, LocalTranscriber } = require(path.join(app.getAppPath(), 'electron/local-speech.cjs'));
      const manager = new WhisperManager(path.join(root, 'test-artifacts/models'));
      try {
        const { DEFAULT_SETTINGS } = require(path.join(app.getAppPath(), 'electron/core.cjs'));
        const pcm = fs.readFileSync(path.join(root, 'test-artifacts/local-test.pcm'));
        const rows = new Map(), errors = [];
        const transcriber = new LocalTranscriber({ manager, settings: { ...DEFAULT_SETTINGS, sourceLanguage: 'en', targetLanguage: 'off' }, translateText: async () => '', onSegment: row => rows.set(row.id, row), onFatal: e => errors.push(e), onWarning: e => errors.push(e) });
        await transcriber.connect();
        for (let i = 0; i < pcm.length; i += 4800) transcriber.push(pcm.subarray(i, i + 4800));
        await transcriber.stop();
        if (errors.length) throw new Error(errors.join('; '));
        const sensevoice = [...rows.values()].map(row => row.text).join(' ');
        await manager.prepare(false, 'whisper-base', 'en');
        const whisper = await manager.transcribe(pcm, 'en');
        return { sensevoice, whisper };
      }
      finally { manager.dispose(); }
    }, root);
    assert.match(localText.sensevoice, /Windows and Mac/);
    assert.match(localText.whisper, /Windows and Mac/);
    assert.equal(boot.settings.localModel, 'sensevoice'); assert.equal(boot.capabilities.localInstalled, true);
    await page.screenshot({ path: path.join(root, 'test-artifacts/06-packaged-mac.png') });
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByLabel('语音转写引擎').waitFor();
    await page.screenshot({ path: path.join(root, 'test-artifacts/09-packaged-engines.png') });
    fs.writeFileSync(path.join(root, 'test-artifacts/packaged-result.json'), JSON.stringify({ packagedMacArm64: 'passed', nativeSenseVoice: localText, platform: boot.platform, version: boot.appVersion, time: new Date().toISOString() }, null, 2));
    console.log('PASS: packaged Apple Silicon app, ASAR resources, isolated VAD/SenseVoice processes, Whisper model switch and installed user model.');
  } finally { await application.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
