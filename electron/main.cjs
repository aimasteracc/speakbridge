const { app, BrowserWindow, ipcMain, session, desktopCapturer, screen, safeStorage, dialog, clipboard, globalShortcut, Menu, powerMonitor, Tray, nativeImage, systemPreferences } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const { Store } = require('./store.cjs');
const { HistoryActions } = require('./history.cjs');
const { notesPlan } = require('./meeting-notes.cjs');
const { validateSettings, exportSession } = require('./core.cjs');
const { RealtimeTranscriber } = require('./realtime.cjs');
const { SonioxTranscriber } = require('./soniox.cjs');
const { WhisperManager, LocalTranscriber, validateLocalSpeech } = require('./local-speech.cjs');
const { detect, resolveEngines, TextRouter } = require('./providers.cjs');
const { NativeInput, dictationPreferences, dictationSettings, deliverDictation } = require('./dictation.cjs');
const { cleanupDictation } = require('./dictation-cleanup.cjs');

app.setName('SpeakBridge');
if (!app.isPackaged && process.env.SPEAKBRIDGE_DATA_DIR) app.setPath('userData', process.env.SPEAKBRIDGE_DATA_DIR);
const devUrl = !app.isPackaged && process.env.SPEAKBRIDGE_DEV_URL === 'http://127.0.0.1:5173' ? process.env.SPEAKBRIDGE_DEV_URL : null;
let mainWindow, overlay, store, current = null, engine = null, status = 'idle', stopPromise = null, closing = false;
let demoTimers = [], errorMessage = '', shortcutAvailable = false;
let whisper;
let nativeInput, dictationWindow, dictationContext = null, dictationBusy = false, dictationShortcutAvailable = false, dictationLimit;
let preferences, holdAvailable = false, inputAvailable = false, holdMessage = '', watchedKey = null, holdPressed = false;
let dictationFeedback = null, hudTimer, tray, quitting = false, quitDeadline, escaped = false;
let armedInput = null, armedInputTimer;
let inputCommit = null;
let historyActions;
function clearDictationResult(id) {
  if (status !== 'idle' || dictationContext || dictationBusy || armedInput || inputCommit) throw new Error('请先结束当前听写或输入，再清除结果。');
  if (typeof id !== 'string' || current?.id !== id || current.mode !== 'dictation') throw new Error('这条听写结果已不存在。');
  current = null; errorMessage = ''; clearTimeout(hudTimer); dictationWindow?.hide();
  dictationFeedback = { phase: 'done', mode: 'handsfree', targetName: '', message: '' };
  publish('dictation-feedback', dictationFeedback); update(); return true;
}
function feedback(phase, message = '') {
  dictationFeedback = { phase, mode: dictationContext?.mode || dictationFeedback?.mode || 'handsfree', targetName: dictationContext?.targetName || current?.dictation?.targetName || '', message };
  publish('dictation-feedback', dictationFeedback);
}
function readiness() {
  return { preferences, holdAvailable, handsFreeAvailable: dictationShortcutAvailable, inputAvailable,
    microphonePermission: ['darwin', 'win32'].includes(process.platform) ? systemPreferences.getMediaAccessStatus('microphone') : 'unknown',
    modelInstalled: whisper.installed(store.settings.localModel), modelReady: whisper.ready && whisper.readyKey === store.settings.localModel + ':' + (['sensevoice', 'whisper-turbo', 'ensemble'].includes(store.settings.localModel) ? store.settings.sourceLanguage : 'auto'), message: holdMessage };
}
function resetTarget() { void nativeInput.request('clear').catch(() => {}); }
function finishDictation() {
  if (inputCommit || !dictationContext || dictationContext.finishRequested) return;
  dictationContext.finishRequested = true; feedback('finishing', '正在完成识别…'); publish('dictation-end', null);
}
function removeEscape() { if (escaped) globalShortcut.unregister('Escape'); escaped = false; }
function hideAfter(ms = 1400) {
  clearTimeout(hudTimer); hudTimer = setTimeout(() => { if (!dictationContext && !dictationBusy) dictationWindow?.hide(); }, ms);
}
function cancelDictation(message) {
  // A paste already in flight must finish its clipboard restoration. Its
  // result is authoritative, even if a cancel/close event arrives meanwhile.
  if (inputCommit) return false;
  if (armedInput) { cancelInputContext(armedInput.context); armedInput = null; clearTimeout(armedInputTimer); removeEscape(); feedback('done', '已取消输入'); hideAfter(); return; }
  if (dictationContext) {
    cancelInputContext(dictationContext);
    if (status === 'idle') { clearTimeout(dictationLimit); dictationContext = null; resetTarget(); removeEscape(); publish('capture-stop', null); feedback('done', message || '已取消'); hideAfter(); }
    else if (status === 'recording' || status === 'connecting') finishDictation();
  }
  if (typeof message === 'string' && message.length <= 1000) { publish('notice', message); publish('dictation-page', null); mainWindow.show(); }
}
async function configureHold() {
  if (watchedKey === preferences.holdKey && nativeInput.child && (holdAvailable || preferences.holdKey === 'off')) return;
  const result = await nativeInput.request('watch', { key: preferences.holdKey });
  watchedKey = preferences.holdKey; holdAvailable = result.ok === true && result.available === true && preferences.holdKey !== 'off';
  holdMessage = result.message || result.error || ''; publish('dictation-readiness', readiness());
}
async function dictationStatus(prompt = false) {
  if (status !== 'idle' || dictationContext || dictationBusy) return readiness();
  // Request the containing app's permission, not a standalone helper entry.
  // A helper started before the user allowed access may need a fresh process.
  const parentTrusted = process.platform === 'darwin' ? systemPreferences.isTrustedAccessibilityClient(prompt) : true;
  let result = await nativeInput.request('status', { prompt: process.platform !== 'darwin' && prompt });
  if (!result.available && (prompt || parentTrusted)) {
    nativeInput.dispose(); watchedKey = null; holdAvailable = false;
    result = await nativeInput.request('status', { prompt: false });
  }
  inputAvailable = result.available === true;
  if (!inputAvailable && prompt && process.platform === 'darwin') result.message = '辅助功能授权尚未生效。如果系统里已打开开关，请移除列表中的旧 SpeakBridge，再添加当前打开的版本，然后点击重新检查。';
  if (!inputAvailable) holdMessage = result.message;
  await configureHold();
  if (!inputAvailable) holdMessage = result.message;
  const value = readiness(); publish('dictation-readiness', value); return value;
}
async function warmDictation() {
  if (status !== 'idle' || dictationContext || dictationBusy) return readiness();
  const settings = dictationSettings(store.settings); preflight(settings);
  await whisper.prepare(false, settings.localModel, settings.sourceLanguage);
  const value = readiness(); publish('dictation-readiness', value); return value;
}
function nativeEvent(event) {
  if (quitting) return;
  if (event.event === 'watch-error' || event.event === 'helper-error') {
    if (event.event === 'helper-error') inputAvailable = false;
    holdAvailable = false; watchedKey = null; holdMessage = event.message;
    if (holdPressed) { holdPressed = false; publish('dictation-key', false); }
    if (dictationContext?.mode === 'hold') cancelDictation();
    publish('dictation-readiness', readiness()); return;
  }
  if (event.event !== 'hold' || holdPressed === event.pressed) return;
  holdPressed = event.pressed; publish('dictation-key', holdPressed);
  if (holdPressed) { if (!dictationContext) void toggleDictation('hold'); }
  else if (dictationContext?.mode === 'hold') finishDictation();
}

if (!app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', () => { if (mainWindow && !mainWindow.isDestroyed()) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } });

function snapshot() { return { status, session: current, error: errorMessage }; }
function publish(type, payload) {
  for (const window of [mainWindow, overlay, dictationWindow]) if (window && !window.isDestroyed()) window.webContents.send('bridge:event', { type, payload });
}
function update() { publish('session', snapshot()); }
function persist() { if (current && current.mode !== 'dictation') store.saveSession(current); }
function segment(row) {
  if (!current) return;
  const index = current.segments.findIndex(s => s.id === row.id);
  // A rejected/withdrawn hypothesis is a removal, not a blank saved sentence.
  // Explicit errors remain visible even with no recognized words.
  if (!row.text && !row.error && !row.translationError && !row.pending) {
    if (index >= 0) { current.segments.splice(index, 1); persist(); update(); }
    return;
  }
  if (index < 0) current.segments.push(row); else current.segments[index] = row;
  current.segments.sort((a, b) => a.startMs - b.startMs);
  current.durationMs = Date.now() - current.startedAt;
  if (row.final) persist();
  update();
}
function trusted(event, overlayAllowed = false) {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (event.senderFrame !== event.sender.mainFrame || (window !== mainWindow && !(overlayAllowed && (window === overlay || window === dictationWindow)))) throw new Error('请求来源无效。');
  const url = event.senderFrame.url.split('#')[0];
  if (devUrl ? url !== devUrl + '/' : url !== require('node:url').pathToFileURL(path.join(__dirname, '../dist/index.html')).href) throw new Error('请求页面无效。');
}
function handle(name, fn, overlayAllowed = false) {
  ipcMain.handle(name, async (event, ...args) => { trusted(event, overlayAllowed); return fn(...args); });
}
function secureWindow(window) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
}
function load(window, hash = '') {
  if (devUrl) return window.loadURL(devUrl + '/' + hash);
  return window.loadFile(path.join(__dirname, '../dist/index.html'), hash ? { hash: hash.slice(1) } : {});
}
function showOverlay(show) {
  if (!show) { overlay?.close(); return; }
  if (overlay && !overlay.isDestroyed()) { overlay.showInactive(); return; }
  const area = screen.getPrimaryDisplay().workArea;
  overlay = new BrowserWindow({
    width: 820, height: 200, minWidth: 480, minHeight: 150,
    x: Math.round(area.x + (area.width - 820) / 2), y: area.y + area.height - 240,
    frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, show: false,
    resizable: true, hasShadow: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  secureWindow(overlay); overlay.setAlwaysOnTop(true, 'floating');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.once('ready-to-show', () => overlay?.showInactive());
  overlay.on('closed', () => { overlay = null; publish('overlay', false); });
  load(overlay, '#overlay'); publish('overlay', true);
}
function routing(settings = store.settings, needsText = settings.targetLanguage !== 'off', needsSpeech = true) {
  // Fully local transcription must not depend on a readable cloud credential.
  const key = settings.speechProvider === 'local' && !needsText ? '' : store.getKey(), capabilities = detect(settings, whisper);
  const sonioxKey = needsSpeech && settings.speechProvider === 'soniox' ? store.getKey('soniox') : '';
  const engines = resolveEngines(settings, key, capabilities, needsText, needsSpeech, sonioxKey);
  return { key, sonioxKey, engines, router: new TextRouter(settings, key, capabilities, engines.text) };
}
function showDictation() {
  clearTimeout(hudTimer);
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const bounds = { width: 440, height: 132, x: Math.round(area.x + (area.width - 440) / 2), y: area.y + area.height - 156 };
  if (dictationWindow && !dictationWindow.isDestroyed()) { dictationWindow.setBounds(bounds); dictationWindow.showInactive(); return; }
  const window = new BrowserWindow({ ...bounds,
    frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, show: false, focusable: false, resizable: false,
    // focusable:false only prevents key-window focus on macOS. A normal
    // NSWindow can still activate our app when clicked, stealing the target.
    ...(process.platform === 'darwin' ? { type: 'panel', acceptFirstMouse: true } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  dictationWindow = window; secureWindow(window); window.setAlwaysOnTop(true, 'floating');
  // Electron's nonactivating panel already joins all spaces/fullscreen apps.
  // Avoid the regular-window Dock/process-type transformation on macOS.
  if (process.platform !== 'darwin') window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.once('ready-to-show', () => { if (!window.isDestroyed() && (dictationContext || armedInput || dictationFeedback?.phase === 'done')) window.showInactive(); });
  window.on('closed', () => { if (dictationWindow === window) dictationWindow = null; });
  load(window, '#dictation');
}
function cancelInputContext(context) {
  if (!context) return;
  context.cancelled = true; context.abort?.abort();
}
function captureInput(context) {
  context.capture = nativeInput.request('capture', { excludePid: process.pid })
    .catch(error => ({ ok: false, error: error.message, diagnostics: { stage: 'capture', code: 'capture_failed' } }))
    .then(target => {
      context.targetName = target.appName || '';
      context.targetError = target.ok ? '' : target.error || '未能确认目标输入框，文字已保留。';
      context.diagnostics = target.diagnostics;
      // An old AX reply belongs only to its original recording. It may not
      // update a newer HUD, session, or target after cancellation.
      if (!context.cancelled && context.isCurrent()) {
        if (current?.mode === 'dictation' && current.dictation) { current.dictation.targetName = context.targetName; update(); }
        feedback(dictationFeedback?.phase || 'preparing', dictationFeedback?.message || '');
      }
      return target;
    });
}
async function deliverInput(session, context, finalStatus) {
  const transaction = { promise: null };
  context.onWillInsert = () => {
    inputCommit = transaction; removeEscape(); feedback('inserting', '正在输入，请稍候…');
  };
  transaction.promise = deliverDictation(session, nativeInput, context, finalStatus);
  try { return await transaction.promise; }
  finally { if (inputCommit === transaction) inputCommit = null; }
}
function armInput(kind) {
  if (status !== 'idle' || dictationContext || dictationBusy) throw new Error('请先结束当前听写。');
  let session;
  if (kind === 'test') {
    session = { id: crypto.randomUUID(), mode: 'dictation', segments: [{ text: '语音输入测试成功。Hello 123 👋', final: true }], status: 'completed', startedAt: Date.now(), durationMs: 0 };
  } else {
    if (current?.mode !== 'dictation' || !current.dictation?.text || !current.dictation.retryable) throw new Error('这段文字可能已经部分输入，请先检查目标输入框，避免重复。');
    session = current;
  }
  armedInput = { session, kind }; clearTimeout(armedInputTimer);
  removeEscape(); escaped = globalShortcut.register('Escape', () => cancelDictation());
  feedback('selecting', '先点进目标输入框，再点此处“填入”。也可按免持快捷键；不会录音。');
  showDictation(); mainWindow.hide();
  armedInputTimer = setTimeout(() => cancelDictation(), 60000);
  return true;
}
async function insertArmedInput() {
  const pending = armedInput;
  if (!pending || dictationBusy) return;
  dictationBusy = true; clearTimeout(armedInputTimer);
  const context = { targetName: '', targetError: '', cancelled: false, abort: new AbortController(), isCurrent: () => armedInput === pending };
  context.signal = context.abort.signal; pending.context = context;
  try {
    current = pending.session;
    feedback('preparing', '正在定位输入框…'); captureInput(context);
    current.dictation = await deliverInput(current, context, 'completed');
    update(); feedback('done', current.dictation.message); showDictation();
    if (['inserted', 'cancelled'].includes(current.dictation.status)) hideAfter();
  } catch (error) { feedback('done', error.message); showDictation(); }
  finally { if (armedInput === pending) armedInput = null; removeEscape(); resetTarget(); dictationBusy = false; }
}
async function toggleDictation(mode = 'handsfree') {
  if (dictationContext) { if (mode === 'handsfree') finishDictation(); return; }
  if (dictationBusy) return;
  if (armedInput) { if (mode === 'handsfree') await insertArmedInput(); return; }
  if (status !== 'idle') { publish('notice', '请先结束当前会话，再开始听写。'); return; }
  dictationBusy = true;
  const context = { token: crypto.randomUUID(), mode, settings: dictationSettings(store.settings), targetName: '', targetError: '', cancelled: false, finishRequested: false, abort: new AbortController(), isCurrent: () => dictationContext === context };
  context.signal = context.abort.signal;
  dictationContext = context;
  feedback('preparing', '正在准备麦克风…'); showDictation();
  escaped = globalShortcut.register('Escape', () => cancelDictation());
  try {
    preflight(context.settings);
    const provider = preferences.cleanupProvider;
    if (provider && provider !== 'off') {
      const settings = { ...context.settings, textProvider: provider };
      const key = provider === 'api' ? store.getKey() : '';
      const capabilities = detect(settings, whisper);
      resolveEngines(settings, key, capabilities, true, false);
      const router = new TextRouter(settings, key, capabilities, provider);
      context.cleanup = raw => {
        feedback('polishing', '正在整理表达，可按 Esc 取消…');
        return cleanupDictation(raw, { router, provider, settings, signal: context.signal });
      };
    }
    current = null; update();
    // Keep speech capture responsive while accessibility discovery runs. A
    // failed/unknown target can retain the transcript but can never be pasted.
    captureInput(context);
    dictationLimit = setTimeout(() => {
      if (dictationContext === context && status === 'idle') cancelDictation('听写启动超时，请重试。');
    }, 20000);
    publish('dictation-start', { token: context.token, settings: context.settings });
  } catch (error) { cancelDictation(error.message); }
  finally { dictationBusy = false; }
}
function preflight(settings) {
  const route = routing(settings);
  if (route.engines.speech === 'local') {
    validateLocalSpeech(settings);
    if (!whisper.installed(settings.localModel)) throw new Error('请先在设置中下载 / 修复所选本地语音模型。');
  }
  return route.engines;
}
async function start(options = {}) {
  if (status !== 'idle') throw new Error('已有会话正在进行。');
  if (dictationBusy || (dictationContext && options.dictationToken !== dictationContext.token)) throw new Error('听写正在准备中。');
  if (options.dictationToken && options.dictationToken !== dictationContext?.token) throw new Error('听写请求已取消，请重新开始。');
  const isDictation = Boolean(options.dictationToken);
  if (!isDictation && armedInput) cancelDictation();
  if (!isDictation) dictationWindow?.close();
  if (isDictation && dictationContext.cancelled) throw new Error('听写已取消。');
  const settings = validateSettings(isDictation ? dictationContext.settings : options.settings || store.settings);
  const demo = !isDictation && options.demo === true;
  const route = demo ? null : routing(settings);
  if (!demo) preflight(settings);
  status = 'connecting'; errorMessage = '';
  current = { id: crypto.randomUUID(), title: demo ? '跨语言产品会议 · 演示' : '新会话 · ' + new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }), startedAt: Date.now(), durationMs: 0, audioSource: settings.audioSource, sourceLanguage: demo ? 'ja' : settings.sourceLanguage, targetLanguage: demo ? 'zh' : settings.targetLanguage, demo, segments: [], notes: '', starred: false, status: 'recording' };
  if (isDictation) { clearTimeout(dictationLimit); dictationLimit = setTimeout(finishDictation, 120000); current.mode = 'dictation'; current.dictation = { status: 'pending', text: '', targetName: dictationContext.targetName, message: dictationContext.targetError || (dictationContext.mode === 'hold' ? '松开按键即可输入' : '再按一次快捷键即可输入') }; feedback(dictationContext.finishRequested ? 'finishing' : 'listening', dictationContext.finishRequested ? '正在完成识别…' : '正在聆听'); }
  if (route) { current.engines = route.engines; if (route.engines.speech === 'local') current.speechModel = settings.localModel; }
  update();
  try {
    if (!demo) {
      const sessionId = current.id;
      const callbacks = { settings, apiKey: route.key, manager: whisper, translateText: (text, signal) => route.router.translate(text, signal), onSegment: row => { if (current?.id === sessionId) segment(row); },
        onFatal: message => { errorMessage = message; publish('capture-stop', null); stop('interrupted').catch(report); },
        onWarning: message => { errorMessage = message; update(); },
      };
      engine = route.engines.speech === 'soniox' ? new SonioxTranscriber({ ...callbacks, apiKey: route.sonioxKey }) : route.engines.speech === 'api' ? new RealtimeTranscriber(callbacks) : new LocalTranscriber(callbacks);
      await engine.connect();
    }
    status = 'recording'; if (!isDictation) current.startedAt = Date.now(); persist(); update();
    if (isDictation) {
      // Cancellation must also settle without a renderer (crash, suspend, quit).
      if (dictationContext.cancelled) return await stop('interrupted');
    }
    if (settings.viewMode === 'subtitle') showOverlay(true);
    if (demo) runDemo();
    return snapshot();
  } catch (error) {
    if (isDictation) { clearTimeout(dictationLimit); dictationContext = null; resetTarget(); removeEscape(); feedback('done', error.message); }
    await engine?.stop(); engine = null; current = null; status = 'idle'; errorMessage = error.message; update(); throw error;
  }
}
function report(error) { errorMessage = error.message; update(); }
function runDemo() {
  const lines = [
    ['今日は、新しいアプリのリリースについて話しましょう。', '今天我们来讨论一下新应用的发布。'],
    ['Windows と Mac、どちらでも同じように使えることが大切です。', '让 Windows 和 Mac 用户都能获得一致的使用体验，这一点很重要。'],
    ['リアルタイムの字幕があれば、言語の壁を越えて会話できますね。', '有了实时字幕，我们就能跨越语言障碍，自在交流了。'],
  ];
  lines.forEach(([text, translation], i) => {
    const row = { id: 'demo-' + i, startMs: i * 4000, endMs: (i + 1) * 4000, text: '', translation: '', final: false };
    [...text].forEach((_, j) => demoTimers.push(setTimeout(() => { row.text = [...text].slice(0, j + 1).join(''); segment({ ...row }); }, i * 4000 + j * 65 + 500)));
    demoTimers.push(setTimeout(() => { Object.assign(row, { text, translation, final: true }); segment({ ...row }); }, i * 4000 + 3200));
  });
  demoTimers.push(setTimeout(() => stop().catch(report), 12500));
}
async function stop(finalStatus = 'completed') {
  if (inputCommit) return stopPromise || inputCommit.promise.then(() => snapshot());
  if (dictationContext && finalStatus !== 'completed') {
    cancelInputContext(dictationContext);
  }
  // A cancelled model startup must settle before the recording resources are
  // drained. start() will publish the stop event as soon as connect resolves.
  if (dictationContext && status === 'connecting') { cancelInputContext(dictationContext); return snapshot(); }
  if (stopPromise) return stopPromise;
  if (status === 'idle') return snapshot();
  stopPromise = (async () => {
    status = 'stopping'; if (dictationContext) feedback('finishing', '正在定稿并输入…'); publish('capture-stop', null); update();
    demoTimers.forEach(clearTimeout); demoTimers = [];
    await engine?.stop(); engine = null;
    if (current) {
      current.endedAt = Date.now(); current.durationMs = current.endedAt - current.startedAt; current.status = finalStatus;
      if (current.mode === 'dictation' && dictationContext) {
        clearTimeout(dictationLimit);
        current.dictation = await deliverInput(current, dictationContext, finalStatus);
        dictationContext = null; resetTarget(); removeEscape(); feedback('done', current.dictation.message);
        if (['inserted', 'cancelled', 'empty'].includes(current.dictation.status)) hideAfter();
        if (!holdAvailable) void configureHold().catch(() => {});
      }
      current.segments = current.segments.map(row => ({ ...row, final: true }));
      const first = current.segments.find(row => row.text.trim());
      if (first && !current.demo) current.title = first.text.slice(0, 40);
      persist();
    }
    status = 'idle'; update(); publish('history', store.sessions);
    if (quitting) { clearTimeout(quitDeadline); setImmediate(() => app.quit()); }
    return snapshot();
  })();
  try { return await stopPromise; } finally { stopPromise = null; }
}

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'), safeStorage);
  historyActions = new HistoryActions(store, {
    onNotesProgress: progress => publish('notes-progress', progress),
    isActive: id => current?.id === id && status !== 'idle',
    onChange: changed => {
      const ids = Array.isArray(changed) ? changed : [changed];
      if (current && ids.includes(current.id) && status === 'idle') { current = store.sessions.find(value => value.id === current.id) || null; update(); }
      publish('history', store.sessions);
    },
  });
  whisper = new WhisperManager(path.join(store.directory, 'models'), progress => publish('model-progress', progress));
  preferences = dictationPreferences(store.read('dictation-settings.json', {}));
  nativeInput = new NativeInput(store.directory, { onEvent: nativeEvent });
  mainWindow = new BrowserWindow({ width: 1280, height: 900, minWidth: 900, minHeight: 650, title: '声桥 · SpeakBridge', backgroundColor: '#ffffff', show: false,
    titleBarStyle: 'hidden', trafficLightPosition: { x: 18, y: 17 },
    ...(process.platform === 'win32' ? { titleBarOverlay: { color: '#f7f8fa', symbolColor: '#222222', height: 48 } } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  secureWindow(mainWindow);
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const allowed = contents === mainWindow.webContents && (permission === 'display-capture' || (permission === 'media' && (!details.mediaTypes || details.mediaTypes.every(type => type === 'audio'))));
    callback(allowed);
  });
  session.defaultSession.setPermissionCheckHandler((contents, permission) => contents === mainWindow.webContents && ['media', 'display-capture'].includes(permission));
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    if (request.frame !== mainWindow.webContents.mainFrame) return callback({});
    try { const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }); callback(sources.length ? { video: sources[0], audio: 'loopback' } : {}); }
    catch { callback({}); }
  }, { useSystemPicker: true });
  handle('bootstrap', () => ({ settings: store.publicSettings(), sessions: store.sessions, state: snapshot(), platform: process.platform, osVersion: os.release(), appVersion: app.getVersion(), shortcutAvailable, dictationShortcutAvailable, dictation: readiness(), dictationFeedback, dataDirectory: store.directory, capabilities: detect(store.settings, whisper) }), true);
  handle('engines:check', settings => preflight(validateSettings(settings)));
  handle('engines:detect', () => detect(store.settings, whisper));
  handle('model:prepare', async () => { if (status !== 'idle' || dictationContext || dictationBusy) throw new Error('请先结束会话或听写。'); await whisper.prepare(true, store.settings.localModel, store.settings.sourceLanguage); return detect(store.settings, whisper); });
  handle('settings:save', input => { if (status !== 'idle' || dictationContext || dictationBusy) throw new Error('请先结束当前会话，再修改设置。'); return store.saveSettings(input); });
  handle('connection:test', async () => {
    if (status !== 'idle' || dictationContext || dictationBusy) throw new Error('请先结束当前会话。');
    const route = routing(store.settings, store.settings.targetLanguage !== 'off' || store.settings.textProvider === 'api'); preflight(store.settings);
    if (route.engines.speech === 'api') {
      const check = new RealtimeTranscriber({ settings: store.settings, apiKey: route.key, onSegment: () => {}, onFatal: () => {}, onWarning: () => {} });
      try { await check.connect(); } finally { await check.stop(); }
    } else if (route.engines.speech === 'soniox') {
      const check = new SonioxTranscriber({ settings: { ...store.settings, targetLanguage: 'off' }, apiKey: route.sonioxKey, onSegment: () => {}, onFatal: () => {}, onWarning: () => {} });
      await check.testConnection();
    } else await whisper.prepare(false, store.settings.localModel, store.settings.sourceLanguage);
    if (store.settings.targetLanguage !== 'off') await route.router.translate('Hello.');
    else if (store.settings.textProvider === 'api') await route.router.generate('Reply with OK only.', 'Connection test.', undefined, { timeoutMs: 60000, maxOutputTokens: 1024, ...(notesPlan({ status: 'completed', segments: [{ text: 'test' }] }, store.settings, 'api').deepseek ? { reasoningEffort: 'none' } : {}) });
    return true;
  });
  handle('session:start', start);
  handle('session:stop', () => stop());
  handle('dictation:permission', async prompt => {
    if (status !== 'idle' || dictationContext || dictationBusy) throw new Error('请先结束当前会话。');
    return nativeInput.request('status', { prompt: prompt === true });
  });
  handle('dictation:status', prompt => dictationStatus(prompt === true));
  handle('dictation:warm', warmDictation);
  handle('dictation:preferences', async input => {
    if (status !== 'idle' || dictationContext || dictationBusy) throw new Error('请先结束听写，再修改快捷键。');
    const next = dictationPreferences(input);
    const old = preferences.handsFreeShortcut;
    if (next.handsFreeShortcut !== old && next.handsFreeShortcut !== 'off' && !globalShortcut.register(next.handsFreeShortcut, () => { void toggleDictation(); })) throw new Error('这个快捷键已被其他应用占用，请选择另一个。');
    try { store.write('dictation-settings.json', next); }
    catch (error) { if (next.handsFreeShortcut !== old && next.handsFreeShortcut !== 'off') globalShortcut.unregister(next.handsFreeShortcut); throw error; }
    if (next.handsFreeShortcut !== old && old !== 'off') globalShortcut.unregister(old);
    preferences = next; dictationShortcutAvailable = next.handsFreeShortcut !== 'off' && globalShortcut.isRegistered(next.handsFreeShortcut);
    return dictationStatus();
  });
  handle('dictation:finish', finishDictation, true);
  handle('dictation:arm-input', kind => armInput(kind === 'test' ? 'test' : 'retry'), true);
  handle('dictation:insert-armed', insertArmedInput, true);
  handle('dictation:cancel', cancelDictation, true);
  ipcMain.on('dictation:level', (event, level) => {
    try { trusted(event); if (dictationContext && typeof level === 'number' && Number.isFinite(level)) publish('dictation-level', Math.max(0, Math.min(1, level))); } catch {}
  });
  handle('dictation:copy', async kind => {
    if (inputCommit) throw new Error('正在完成自动输入，请稍后复制。');
    if (current?.mode !== 'dictation' || status !== 'idle' || !current.dictation?.text) throw new Error('还没有可复制的听写文字。');
    await clipboard.writeText(kind === 'original' ? current.dictation.rawText || current.dictation.text : current.dictation.text); return true;
  }, true);
  handle('dictation:hide', () => { if (dictationContext || dictationBusy) throw new Error('请先结束或取消听写。'); dictationWindow?.hide(); }, true);
  handle('dictation:clear', clearDictationResult, true);
  ipcMain.on('audio:chunk', (event, data) => {
    try { trusted(event); if (!(data instanceof Uint8Array) || data.byteLength === 0 || data.byteLength > 48000 || data.byteLength % 2) return; engine?.push(Buffer.from(data)); } catch (error) { report(error); }
  });
  handle('history:list', () => store.sessions);
  handle('history:delete', id => historyActions.deleteSession(id));
  handle('history:delete-notes', id => historyActions.deleteNotes(id));
  handle('history:delete-many', ids => historyActions.deleteSessions(ids));
  handle('history:delete-notes-many', ids => historyActions.deleteNotesMany(ids));
  handle('history:update', (id, patch) => {
    const value = { ...store.find(id) };
    if (typeof patch.title === 'string' && patch.title.trim() && patch.title.length <= 120) value.title = patch.title.trim();
    if (typeof patch.starred === 'boolean') value.starred = patch.starred;
    store.saveSession(value); return value;
  });
  handle('history:export', async (id, format) => {
    if (!['txt', 'md', 'srt'].includes(format)) throw new Error('不支持的导出格式。');
    const value = store.find(id);
    const filename = value.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 70);
    const result = await dialog.showSaveDialog(mainWindow, { defaultPath: `${filename}.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] });
    if (result.canceled || !result.filePath) return false;
    await fs.promises.writeFile(result.filePath, exportSession(value, format), 'utf8'); return true;
  });
  handle('history:copy', id => { if (inputCommit) throw new Error('正在完成自动输入，请稍后复制。'); clipboard.writeText(exportSession(store.find(id), 'txt')); return true; });
  handle('history:retry', async id => {
    let router;
    return historyActions.retryTranslation(id, (text, targetLanguage) => {
      router ||= routing({ ...store.settings, targetLanguage }, true, false).router;
      return router.translate(text);
    });
  });
  handle('history:notes', async (id, language = 'auto') => {
    const settings = { ...store.settings }, route = routing(settings, true, false);
    return historyActions.makeNotes(id, (instructions, input, signal, options) => route.router.generate(instructions, input, signal, options), { settings, provider: route.engines.text, language });
  });
  handle('history:notes-status', id => historyActions.notesStatus(id));
  handle('history:notes-cancel', id => historyActions.cancelNotes(id));
  handle('history:notes-plan', (id, language = 'auto') => {
    const provider = store.settings.textProvider === 'auto' && store.publicSettings().hasKey ? 'api' : store.settings.textProvider;
    return notesPlan(store.find(id), store.settings, provider, language);
  });
  handle('overlay:show', show => showOverlay(show === true));
  handle('overlay:hide', () => showOverlay(false), true);
  shortcutAvailable = globalShortcut.register('CommandOrControl+Shift+Space', () => { if (status === 'idle') mainWindow.show(); publish('toggle-recording', null); });
  globalShortcut.register('CommandOrControl+Shift+L', () => showOverlay(!overlay));
  dictationShortcutAvailable = preferences.handsFreeShortcut !== 'off' && globalShortcut.register(preferences.handsFreeShortcut, () => { void toggleDictation(); });
  void dictationStatus().catch(error => { holdMessage = error.message; publish('dictation-readiness', readiness()); });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: 'SpeakBridge', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'quit' }] }] : []),
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }] },
  ]));
  const trayIcon = nativeImage.createFromPath(path.join(__dirname, 'tray.png')).resize({ width: 20, height: 20 });
  tray = new Tray(trayIcon); tray.setToolTip('声桥 · 语音输入');
  const openMain = () => { mainWindow.show(); mainWindow.focus(); };
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开声桥', click: openMain },
    { label: '语音输入与快捷键', click: () => { publish('dictation-page', null); openMain(); } },
    { type: 'separator' }, { label: '退出声桥', click: () => app.quit() },
  ]));
  tray.on('double-click', openMain);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', event => {
    if (quitting) return;
    event.preventDefault();
    // Meetings keep their established stop-on-close behavior. Only dictation
    // has a separate, visible recording HUD while the main window is hidden.
    if (status !== 'idle' && current?.mode !== 'dictation') {
      if (!closing) { closing = true; publish('capture-stop', null); void stop('interrupted').finally(() => { closing = false; mainWindow.hide(); }); }
    } else mainWindow.hide();
  });
  mainWindow.on('closed', () => { overlay?.destroy(); dictationWindow?.destroy(); });
  app.on('activate', openMain);
  mainWindow.webContents.on('render-process-gone', () => {
    cancelDictation();
    void stop('interrupted').catch(report).finally(() => { if (!quitting && !mainWindow.isDestroyed()) void load(mainWindow); });
  });
  powerMonitor.on('suspend', () => {
    if (dictationContext) cancelDictation();
    if (status !== 'idle') { errorMessage = '系统进入休眠，会话已结束。'; publish('capture-stop', null); stop('interrupted').catch(report); }
  });
  load(mainWindow);
}).catch(error => { dialog.showErrorBox('声桥启动失败', error.message); app.quit(); });
app.on('before-quit', event => {
  if (quitting) return;
  if (inputCommit) {
    event.preventDefault(); quitting = true;
    // The helper must return after restoring the clipboard before shutdown.
    void inputCommit.promise.finally(() => app.quit()); return;
  }
  if (status !== 'idle' || dictationContext) {
    event.preventDefault(); quitting = true; cancelDictation(); publish('capture-stop', null);
    cancelInputContext(dictationContext);
    // Do not hold the OS exit open indefinitely for a slow model startup.
    quitDeadline = setTimeout(() => { nativeInput?.dispose(); whisper?.dispose(); app.exit(0); }, 5000);
    if (status === 'connecting') { void stop('interrupted'); return; }
    void stop('interrupted').finally(() => { clearTimeout(quitDeadline); app.quit(); });
  } else quitting = true;
});
app.on('will-quit', () => { clearTimeout(hudTimer); tray?.destroy(); clearTimeout(dictationLimit); nativeInput?.dispose(); whisper?.dispose(); globalShortcut.unregisterAll(); });
app.on('window-all-closed', () => app.quit());
