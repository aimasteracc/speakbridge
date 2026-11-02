// Isolated Electron UI + real WebSocket transport with a local Soniox fixture.
// No microphone, cloud requests, user credentials or user history.
const { _electron: electron } = require('playwright');
const { WebSocketServer } = require('ws');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'speakbridge-soniox-'));
const version = require('../package.json').version;
let app, server;
(async () => {
  try {
    server = new WebSocketServer({ port: 0, host: '127.0.0.1' }); await new Promise(resolve => server.once('listening', resolve));
    let bytes = 0, eof = false, authorization;
    server.on('connection', (socket, request) => {
      authorization = request.headers.authorization;
      socket.on('message', (data, binary) => {
        const send = (text, final, end = false) => socket.send(JSON.stringify({ tokens: [{ text, is_final: final, start_ms: 100, end_ms: 1000 }, ...(end ? [{ text: '<end>', is_final: true }] : [])] }));
        if (binary) {
          bytes += data.length;
          send('。', false); send('。', true, true);
          send('撤回的初稿', false);
          setTimeout(() => send('。', true, true), 20);
          setTimeout(() => send('声音巧接', false), 70);
          setTimeout(() => send('声桥连接成功', false), 450);
        } else if (!data.length) {
          eof = true; send('声桥连接成功。', true, true); socket.send(JSON.stringify({ tokens: [], finished: true })); socket.close();
        } else { const config = JSON.parse(data); assert.equal(config.model, 'stt-rt-v5'); assert.equal(config.audio_format, 'pcm_s16le'); }
      });
    });
    const env = { ...process.env, SPEAKBRIDGE_DATA_DIR: dir }; delete env.ELECTRON_RUN_AS_NODE;
    const executablePath = process.env.SPEAKBRIDGE_TEST_EXECUTABLE;
    app = await electron.launch({ ...(executablePath ? { executablePath, args: ['--user-data-dir=' + dir] } : { args: [root] }), env });
    assert.equal(fs.realpathSync(await app.evaluate(({ app }) => app.getPath('userData'))), fs.realpathSync(dir));
    const page = await app.firstWindow(); await page.getByRole('heading', { name: '实时翻译', exact: true }).waitFor();
    await app.evaluate(({ app }, port) => {
      const require = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/electron/main.cjs');
      const WebSocket = require('ws'), { SonioxTranscriber } = require('./soniox.cjs');
      const connect = SonioxTranscriber.prototype.connect;
      SonioxTranscriber.prototype.connect = function () { this.socketFactory = (_url, options) => new WebSocket(`ws://127.0.0.1:${port}`, options); return connect.call(this); };
    }, server.address().port);
    const initial = await page.evaluate(() => window.speakbridge.bootstrap());
    await assert.rejects(page.evaluate(s => window.speakbridge.checkEngines({ ...s, speechProvider: 'soniox', targetLanguage: 'off' }), initial.settings), /Soniox API Key/);
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByLabel('语音转写引擎').selectOption('soniox');
    await page.getByLabel('Soniox API Key').fill('synthetic-soniox-secret');
    await page.getByRole('button', { name: '保存 Soniox 设置' }).click();
    await page.getByText('设置已保存', { exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Soniox 实时转写', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(root, `test-artifacts/${version}-soniox-settings.png`) });
    const saved = await page.evaluate(async () => {
      const b = await window.speakbridge.bootstrap(); return window.speakbridge.saveSettings({ ...b.settings, sourceLanguage: 'zh', targetLanguage: 'off' });
    });
    assert.equal(saved.hasSonioxKey, true); assert.equal(saved.sonioxApiKey, undefined); assert.equal(saved.hasKey, false);
    assert.ok(!fs.readFileSync(path.join(dir, 'soniox-credential.json'), 'utf8').includes('synthetic-soniox-secret'));
    await page.getByRole('button', { name: '实时翻译', exact: true }).click();
    await page.evaluate(async s => { await window.speakbridge.start({ demo: false, settings: s }); window.speakbridge.audio(new Uint8Array(4800)); }, saved);
    await page.locator('.original-text').filter({ hasText: '声音巧接' }).waitFor();
    await page.locator('.original-text').filter({ hasText: '声桥连接成功' }).waitFor();
    assert.equal(await page.locator('.transcript-row').count(), 1);
    await page.locator('.transcript-row.partial .live-caret.active').waitFor({ state: 'attached' });
    await page.getByText('Soniox · 付费转写', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(root, `test-artifacts/${version}-soniox-draft.png`) });
    const result = await page.evaluate(() => window.speakbridge.stop());
    assert.equal(result.status, 'idle'); assert.equal(result.session.engines.speech, 'soniox');
    assert.equal(result.session.segments.length, 1); assert.equal(result.session.segments[0].text, '声桥连接成功。');
    assert.ok(result.session.segments[0].final && !result.session.segments[0].error);
    assert.equal(bytes, 4800); assert.ok(eof); assert.equal(authorization, 'Bearer synthetic-soniox-secret');
    const history = await page.evaluate(() => window.speakbridge.listSessions()); assert.equal(history[0].segments[0].text, '声桥连接成功。');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: '移除 Soniox 密钥' }).click(); await page.getByText('Soniox 密钥已移除').waitFor();
    assert.equal(await page.evaluate(async () => (await window.speakbridge.bootstrap()).settings.hasSonioxKey), false);
    const report = { passed: true, packaged: !!executablePath, version: initial.appVersion, uiCredentialsEncrypted: true, revisedOneRow: true, finalDrainedAndSaved: true, missingKeyRejected: true, cloudRequests: 0 };
    fs.writeFileSync(path.join(root, `test-artifacts/soniox-e2e-${version}.json`), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  } finally { if (app) await app.close(); if (server) { for (const socket of server.clients) socket.terminate(); await new Promise(resolve => server.close(resolve)); } fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
