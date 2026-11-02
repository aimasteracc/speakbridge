const { _electron: electron } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'), version = require('../package.json').version;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'speakbridge-dictation-'));
const dataDir = path.join(dir, 'data'), fixture = path.join(dir, 'target');
const output = path.join(root, 'test-artifacts', `dictation-${version}`); fs.mkdirSync(output, { recursive: true });
let app, target, page, targetPage; const errors = [], checks = [];
checks.push = (...items) => { for (const item of items) console.log('PASS:', item); return Array.prototype.push.apply(checks, items); };
const executablePath = process.env.SPEAKBRIDGE_TEST_EXECUTABLE;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  try {
    assert.equal(process.platform, 'darwin', 'This real keyboard test requires macOS');
    fs.mkdirSync(fixture, { recursive: true });
    for (const name of ['sensevoice', 'vad']) fs.cpSync(path.join(root, 'test-artifacts/models', name), path.join(dataDir, 'models', name), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'dictation-settings.json'), JSON.stringify({ holdKey: 'rightalt', handsFreeShortcut: 'CommandOrControl+Alt+D' }));
    fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ name: 'dictation-target', main: 'main.cjs' }));
    fs.writeFileSync(path.join(fixture, 'main.cjs'), `const {app,BrowserWindow}=require('electron');app.setName('Dictation Test Target');app.whenReady().then(()=>{const w=new BrowserWindow({width:700,height:550,webPreferences:{contextIsolation:true,nodeIntegration:false}});w.loadFile(__dirname+'/index.html');});app.on('window-all-closed',()=>app.quit());`);
    fs.writeFileSync(path.join(fixture, 'index.html'), '<!doctype html><meta charset="utf-8"><title>SpeakBridge isolated input fixture</title><style>body{padding:30px;font:18px sans-serif}textarea,input{display:block;width:90%;margin:15px 0;padding:12px;font:20px sans-serif}</style><h1>隔离输入测试</h1><textarea id="one" aria-label="目标输入框" rows="4"></textarea><textarea id="two" aria-label="第二输入框"></textarea><input id="secret" type="password" aria-label="密码"><script>window.enters=0;addEventListener("keydown",e=>{if(e.key==="Enter")window.enters++})</script>');
    execFileSync('xcrun', ['swiftc', path.join(root, 'tests/dictation-hotkey.swift'), '-o', path.join(dir, 'hotkey')]);
    const env = { ...process.env, SPEAKBRIDGE_DATA_DIR: dataDir }; delete env.ELECTRON_RUN_AS_NODE; delete env.SPEAKBRIDGE_DEV_URL;
    app = await electron.launch({ ...(executablePath ? { executablePath, args: ['--user-data-dir=' + dataDir] } : { args: [root] }), env });
    page = await app.firstWindow(); page.setDefaultTimeout(20000); page.on('pageerror', e => errors.push(e.message));
    await page.getByRole('heading', { name: '实时翻译', exact: true }).waitFor();
    assert.equal(fs.realpathSync(await app.evaluate(({ app }) => app.getPath('userData'))), fs.realpathSync(dataDir));
    const boot = await page.evaluate(() => window.speakbridge.bootstrap()); assert.equal(boot.dictationShortcutAvailable, true, 'Dictation shortcut must register');
    const permission = await page.evaluate(() => window.speakbridge.dictationPermission(false)); assert.equal(permission.available, true, permission.message);
    await app.evaluate(({ session }) => { globalThis.__requests = []; session.defaultSession.webRequest.onBeforeRequest((details, done) => { if (/^https?:/.test(details.url)) globalThis.__requests.push(details.url); done({}); }); });
    await page.evaluate(async () => {
      const b = await window.speakbridge.bootstrap();
      await window.speakbridge.saveSettings({ ...b.settings, speechProvider: 'api', textProvider: 'api', targetLanguage: 'ja', audioSource: 'both', sourceLanguage: 'zh', apiKey: 'synthetic-do-not-send' });
      Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: () => { throw Error('Dictation must not capture system audio'); } });
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
        const context = new AudioContext({ sampleRate: 24000 }), destination = context.createMediaStreamDestination();
        window.__mic = { context, destination };
        const track = destination.stream.getAudioTracks()[0], stop = track.stop.bind(track);
        track.stop = () => { stop(); void context.close(); };
        await context.resume(); return destination.stream;
      } });
    });
    await app.evaluate(({ app }) => {
      const req = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/electron/main.cjs');
      const { WhisperManager } = req('./local-speech.cjs'), { NeuralGate } = req('./neural-gate.cjs');
      const { Store } = req('./store.cjs');
      const save = [[Store.prototype, 'getKey'], [WhisperManager.prototype, 'prepare'], [WhisperManager.prototype, 'transcribeAudio'], [NeuralGate.prototype, 'connect'], [NeuralGate.prototype, 'flush'], [NeuralGate.prototype, 'push']].map(([p, k]) => [p, k, p[k]]);
      Store.prototype.getKey = function () { throw Error('Synthetic unreadable cloud credential'); };
      WhisperManager.prototype.prepare = async function () {};
      WhisperManager.prototype.transcribeAudio = async function () { return globalThis.__phrase || '你好，跨应用听写。Hello 3.14 👋 👩🏽‍💻'; };
      NeuralGate.prototype.connect = async function () {}; NeuralGate.prototype.push = function () {};
      NeuralGate.prototype.flush = async function () { this.onSegment({ audio: new Float32Array([1]), startMs: 0, endMs: 1000, segmentId: 1 }); };
      globalThis.__restore = () => { for (const [p, k, v] of save) p[k] = v; };
    });
    target = await electron.launch({ args: [fixture, '--user-data-dir=' + path.join(dir, 'target-data')], env: { ...env, SPEAKBRIDGE_DATA_DIR: '' } });
    targetPage = await target.firstWindow(); await targetPage.locator('#one').waitFor();
    const targetPID = await target.evaluate(() => process.pid);
    const clipboardBefore = await target.evaluate(async ({ clipboard }) => { const items = await clipboard.read(), result = []; for (const item of items) for (const type of item.types) { const value = await item.getType(type); const bytes = value.arrayBuffer ? Buffer.from(await value.arrayBuffer()) : Buffer.from(JSON.stringify(value)); result.push({ type, hash: process.getBuiltinModule('node:crypto').createHash('sha256').update(bytes).digest('hex') }); } return result; });
    const focus = async id => { await target.evaluate(({ app, BrowserWindow }) => { app.focus({ steal: true }); BrowserWindow.getAllWindows()[0].show(); BrowserWindow.getAllWindows()[0].focus(); }); await targetPage.locator('#' + id).click(); await wait(250); };
    const hotkey = (key = 'dictation', edge = '') => execFileSync(path.join(dir, 'hotkey'), [String(targetPID), key, edge]);
    let state = () => page.evaluate(async () => (await window.speakbridge.bootstrap()).state);
    const until = async predicate => { for (let i = 0; i < 600; i++) { const current = await state(); if (predicate(current)) return current; await wait(100); } throw Error('Timed out waiting for dictation state: ' + JSON.stringify(await state())); };
    const recording = () => until(s => s.status === 'recording' && s.session?.mode === 'dictation');
    const idle = () => until(s => s.status === 'idle' && s.session?.dictation?.status !== 'pending');
    // Original-style push-to-talk: key down records, release finalizes, no second shortcut.
    const ready = await page.evaluate(() => window.speakbridge.dictationStatus(false));
    assert.equal(ready.holdAvailable, true, ready.message);
    await focus('one'); hotkey('rightalt', 'down'); await recording();
    await page.getByRole('heading', { name: '实时翻译', exact: true }).waitFor();
    hotkey('rightalt', 'up'); await idle();
    assert.equal((await state()).session.dictation.status, 'inserted');
    await targetPage.waitForFunction(() => document.querySelector('#one').value.includes('Hello'));
    await wait(1700);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#dictation')).isVisible()), false);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#dictation')).getSize()[1]), 132);
    checks.push('Right Option down/up completes dictation; original page preserved; compact HUD auto-hides after success');
    // Closing the main window leaves a live background app and working dictation.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !w.isAlwaysOnTop()).close());
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !w.isAlwaysOnTop()).isVisible()), false);
    await targetPage.locator('#one').fill(''); await focus('one'); hotkey('rightalt', 'down'); await recording(); hotkey('rightalt', 'up'); await idle();
    assert.equal((await state()).session.dictation.status, 'inserted');
    checks.push('main-window close keeps app alive; hold dictation works in background');
    // Release while the model is connecting must stop the mic immediately, then insert once.
    await app.evaluate(({ app }) => {
      const req = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/electron/main.cjs');
      req('./local-speech.cjs').WhisperManager.prototype.prepare = async () => new Promise(resolve => setTimeout(resolve, 1400));
      globalThis.__startupBytes = 0; req('./neural-gate.cjs').NeuralGate.prototype.push = function (bytes) { globalThis.__startupBytes += bytes.length; };
    });
    await targetPage.locator('#one').fill(''); await focus('one'); hotkey('rightalt', 'down'); await until(s => s.status === 'connecting');
    await wait(350); hotkey('rightalt', 'up');
    for (let i = 0; i < 20 && await page.evaluate(() => window.__mic.destination.stream.getTracks()[0].readyState !== 'ended'); i++) await wait(20);
    assert.equal(await page.evaluate(() => window.__mic.destination.stream.getTracks()[0].readyState), 'ended');
    await idle(); assert.equal((await state()).session.dictation.status, 'inserted');
    assert.ok(await app.evaluate(() => globalThis.__startupBytes) > 0, 'Audio spoken during model startup must reach the engine');
    checks.push('release during model startup closes microphone immediately; buffered PCM is delivered before finalization');
    await app.evaluate(({ app }) => {
      const req = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/electron/main.cjs');
      req('./local-speech.cjs').WhisperManager.prototype.prepare = async () => {};
    });
    await targetPage.locator('#one').fill(''); await focus('one'); hotkey('rightalt', 'down'); await recording(); hotkey('escape'); hotkey('rightalt', 'up'); await idle();
    assert.equal((await state()).session.dictation.status, 'cancelled'); assert.equal(await targetPage.locator('#one').inputValue(), '');
    checks.push('Escape cancels a held dictation with no input');
    // Escape during a delayed microphone permission/device request is silent.
    await page.evaluate(() => {
      window.__originalMic = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async (...args) => { await new Promise(resolve => setTimeout(resolve, 600)); return window.__originalMic(...args); } });
    });
    await focus('one'); hotkey('rightalt', 'down'); await wait(150); hotkey('escape'); hotkey('rightalt', 'up'); await wait(1000);
    assert.equal((await state()).status, 'idle');
    assert.equal(await page.evaluate(() => window.__mic.destination.stream.getTracks()[0].readyState), 'ended');
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !w.isAlwaysOnTop()).isVisible()), false);
    assert.equal(await targetPage.locator('#one').inputValue(), '');
    await page.evaluate(() => Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: window.__originalMic }));
    checks.push('cancel during microphone preparation stops late tracks and does not reopen main window');
    // Shortcut conflicts leave the last working preference unchanged.
    await app.evaluate(({ globalShortcut }) => globalShortcut.register('F8', () => {}));
    await assert.rejects(page.evaluate(() => window.speakbridge.saveDictationPreferences({ holdKey: 'rightalt', handsFreeShortcut: 'F8' })), /占用/);
    assert.equal((await page.evaluate(() => window.speakbridge.dictationStatus(false))).preferences.handsFreeShortcut, 'CommandOrControl+Alt+D');
    await app.evaluate(({ globalShortcut }) => globalShortcut.unregister('F8'));
    checks.push('shortcut conflict keeps previous working binding');
    await focus('one'); hotkey(); await recording();
    assert.equal((await state()).session.mode, 'dictation'); assert.deepEqual((await state()).session.engines, { speech: 'local', text: 'off' });
    assert.equal((await state()).session.audioSource, 'microphone');
    const initialHud = app.windows().find(w => w !== page) || await app.waitForEvent('window');
    await initialHud.getByLabel('听写文字').waitFor();
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#dictation')).isFocusable()), false);
    hotkey(); await idle();
    assert.equal((await state()).session.dictation.status, 'inserted', JSON.stringify((await state()).session.dictation));
    await targetPage.waitForFunction(() => document.querySelector('#one').value.includes('Hello 3.14 👋 👩🏽‍💻'));
    assert.equal(await targetPage.locator('#one').inputValue(), '你好，跨应用听写。Hello 3.14 👋 👩🏽‍💻');
    assert.equal(await targetPage.evaluate(() => window.enters), 0); checks.push('real global shortcut -> local route -> native insertion; Unicode + ZWJ emoji; no Enter; non-activating HUD; unreadable cloud credential does not block local mode');
    await targetPage.screenshot({ path: path.join(output, 'native-insertion.png') });
    // A new input field in the SAME application must not receive the result.
    await focus('one'); hotkey(); await recording(); await targetPage.locator('#two').click(); hotkey(); await idle();
    assert.equal((await state()).session.dictation.status, 'retained'); assert.equal(await targetPage.locator('#two').inputValue(), ''); checks.push('same-app focus change retains result without typing');
    await focus('one'); hotkey(); await recording();
    await targetPage.evaluate(() => document.querySelector('#one').setSelectionRange(0, 0)); hotkey(); await idle();
    assert.equal((await state()).session.dictation.status, 'retained'); checks.push('caret change retains result');
    await focus('one'); hotkey(); await recording();
    await app.evaluate(({ app, BrowserWindow }) => { app.focus({ steal: true }); BrowserWindow.getAllWindows().find(w => !w.isAlwaysOnTop()).focus(); });
    await page.evaluate(() => window.speakbridge.stop()); await idle();
    assert.equal((await state()).session.dictation.status, 'retained'); checks.push('different foreground app receives no text');
    // Capture does not block speech; an unsafe destination retains the final
    // transcript and must never receive a paste.
    await focus('secret'); hotkey(); await recording(); hotkey(); await idle();
    assert.equal((await state()).session.dictation.status, 'retained');
    assert.equal((await state()).session.dictation.diagnostics.code, 'TARGET_SECURE');
    assert.equal(await targetPage.locator('#secret').inputValue(), ''); checks.push('password target retains recognized text without input');
    await focus('two'); hotkey(); await recording(); await page.evaluate(() => window.speakbridge.cancelDictation()); await idle();
    assert.equal((await state()).session.dictation.status, 'cancelled'); assert.equal(await targetPage.locator('#two').inputValue(), ''); checks.push('cancel produces no input');
    await app.evaluate(() => { globalThis.__phrase = '。'; }); await focus('two'); hotkey(); await recording(); hotkey(); await idle();
    assert.equal((await state()).session.dictation.status, 'empty'); assert.equal(await targetPage.locator('#two').inputValue(), ''); checks.push('punctuation-only recognition never types');
    assert.deepEqual(await target.evaluate(async ({ clipboard }) => { const items = await clipboard.read(), result = []; for (const item of items) for (const type of item.types) { const value = await item.getType(type); const bytes = value.arrayBuffer ? Buffer.from(await value.arrayBuffer()) : Buffer.from(JSON.stringify(value)); result.push({ type, hash: process.getBuiltinModule('node:crypto').createHash('sha256').update(bytes).digest('hex') }); } return result; }), clipboardBefore);
    checks.push('clipboard formats and bytes unchanged');
    await app.evaluate(() => { globalThis.__phrase = '复制测试'; });
    await focus('one'); hotkey(); await recording(); await targetPage.locator('#two').click(); hotkey(); await idle();
    await app.evaluate(({ clipboard }) => { globalThis.__writeClipboard = clipboard.writeText; clipboard.writeText = async text => { globalThis.__copyOutput = text; }; });
    const copyHud = app.windows().find(w => w.url().endsWith('#dictation'));
    await copyHud.getByRole('button', { name: '复制', exact: true }).click();
    await copyHud.getByText('已复制', { exact: true }).waitFor();
    assert.equal(await app.evaluate(() => globalThis.__copyOutput), '复制测试');
    await app.evaluate(({ clipboard }) => { clipboard.writeText = globalThis.__writeClipboard; });
    checks.push('manual copy button sends only the dictated text');
    // Cancel while the model is connecting, before the recorder is enabled.
    await app.evaluate(({ app }) => {
      const req = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/electron/main.cjs');
      req('./local-speech.cjs').WhisperManager.prototype.prepare = async () => new Promise(resolve => setTimeout(resolve, 800));
    });
    await focus('two'); hotkey(); await until(s => s.status === 'connecting');
    await page.evaluate(() => window.speakbridge.cancelDictation()); await idle();
    assert.equal((await state()).session.dictation.status, 'cancelled'); assert.equal(await targetPage.locator('#two').inputValue(), '');
    checks.push('cancel during model startup drains without insertion');
    await app.evaluate(() => globalThis.__restore());
    // Real public audio goes through a synthetic MediaStream, AudioWorklet,
    // native VAD + SenseVoice, finalization and OS input. No user microphone.
    const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(root, 'test-artifacts/asr-quality/zh-10053956375630517392.wav'), '-f', 's16le', '-ac', '1', '-ar', '24000', 'pipe:1']);
    await focus('two'); hotkey(); await recording();
    await page.evaluate(async bytes => {
      const { context, destination } = window.__mic;
      const data = new DataView(Uint8Array.from(bytes).buffer), buffer = context.createBuffer(1, data.byteLength / 2, 24000), samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = data.getInt16(i * 2, true) / 32768;
      const source = context.createBufferSource(); source.buffer = buffer; source.connect(destination);
      await new Promise(resolve => { source.onended = resolve; source.start(); });
    }, [...pcm]);
    hotkey(); await idle();
    const final = (await state()).session.dictation;
    assert.equal(final.status, 'inserted', final.message); assert.match(final.text, /博客/); assert.match(final.text, /观点/);
    await targetPage.waitForFunction(text => document.querySelector('#two').value === text, final.text);
    checks.push('real Chinese recording through AudioWorklet + native SenseVoice -> external input');
    assert.deepEqual(await page.evaluate(() => window.speakbridge.listSessions()), []);
    const settings = await page.evaluate(async () => (await window.speakbridge.bootstrap()).settings); assert.equal(settings.speechProvider, 'api'); assert.equal(settings.targetLanguage, 'ja');
    assert.deepEqual(await app.evaluate(() => globalThis.__requests), []); assert.deepEqual(errors, []);
    checks.push('no saved dictation history, no HTTP requests, existing engine settings preserved');
    await app.evaluate(({ app, BrowserWindow }) => { app.focus({ steal: true }); BrowserWindow.getAllWindows().find(w => !w.isAlwaysOnTop()).show(); });
    await page.getByRole('button', { name: '语音输入', exact: true }).click();
    await page.screenshot({ path: path.join(output, 'dictation-page.png') });
    const hud = app.windows().find(w => w.url().endsWith('#dictation')); await hud.screenshot({ path: path.join(output, 'dictation-hud.png') });
    // A renderer crash while loading must cancel in the main process and reload the page.
    await app.evaluate(({ app }) => {
      const req = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/electron/main.cjs');
      req('./local-speech.cjs').WhisperManager.prototype.prepare = async () => new Promise(resolve => setTimeout(resolve, 1000));
    });
    const beforeCrashText = await targetPage.locator('#one').inputValue();
    await focus('one'); hotkey(); await until(s => s.status === 'connecting');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !w.isAlwaysOnTop()).webContents.forcefullyCrashRenderer());
    state = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !w.isAlwaysOnTop()).webContents.executeJavaScript('window.speakbridge.bootstrap().then(b => b.state)'));
    for (let i = 0; i < 100; i++) { try { if ((await state()).status === 'idle') break; } catch {} await wait(100); }
    assert.equal((await state()).status, 'idle'); assert.equal((await state()).session.dictation.status, 'cancelled');
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !w.isAlwaysOnTop()).webContents.executeJavaScript('document.querySelector(\'h1\').textContent')), '实时翻译');
    assert.equal(await targetPage.locator('#one').inputValue(), beforeCrashText);
    checks.push('renderer crash during startup cancels without insertion and reloads to usable idle state');
    // Reload drops page mocks: install a fresh synthetic mic before any new start.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !w.isAlwaysOnTop()).webContents.executeJavaScript(`Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      const context = new AudioContext({ sampleRate: 24000 }), destination = context.createMediaStreamDestination();
      const track = destination.stream.getAudioTracks()[0], stop = track.stop.bind(track);
      track.stop = () => { stop(); void context.close(); }; await context.resume(); return destination.stream;
    } }); true;`));
    await focus('one'); hotkey(); await until(s => s.status === 'connecting');
    const quitAt = Date.now(), closed = app.waitForEvent('close');
    await app.evaluate(({ app }) => { app.quit(); }); await closed;
    assert.ok(Date.now() - quitAt < 3500, 'A settling model startup should quit normally, without the 5 s watchdog');
    assert.equal(await targetPage.locator('#one').inputValue(), beforeCrashText);
    checks.push('quit during model startup cancels and exits normally without waiting for watchdog');
    app = null;
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: true, version, packaged: !!executablePath, checks, nativeTranscript: final.text, pageErrors: errors }, null, 2));
    console.log(JSON.stringify({ passed: true, checks }, null, 2));
  } finally {
    if (target) await target.close().catch(() => {}); if (app) await app.close().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
