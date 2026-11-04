const { app, BrowserWindow, ipcMain, session, desktopCapturer, screen, safeStorage, dialog, clipboard, globalShortcut, Menu, powerMonitor, Tray, nativeImage, systemPreferences, protocol, ClipboardItem, utilityProcess, Notification } = require('electron');
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
const { MeetingReminder } = require('./meeting-reminder.cjs');
const { ScreenAssistant } = require('./screen-assistant.cjs');
const { Shortcuts, NATIVE } = require('./shortcuts.cjs');
const { ClipboardHistory } = require('./clipboard-history.cjs');
const { MediaLibrary } = require('./media.cjs');
const { documentHTML, documentDOCX } = require('./document-export.cjs');
protocol.registerSchemesAsPrivileged([{ scheme: 'speakbridge-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

app.setName('SpeakBridge');
if (!app.isPackaged && process.env.SPEAKBRIDGE_DATA_DIR) app.setPath('userData', process.env.SPEAKBRIDGE_DATA_DIR);
const devUrl = !app.isPackaged && process.env.SPEAKBRIDGE_DEV_URL === 'http://127.0.0.1:5173' ? process.env.SPEAKBRIDGE_DEV_URL : null;
let mainWindow, overlay, meetingToolbar, store, current = null, engine = null, status = 'idle', stopPromise = null, closing = false;
let demoTimers = [], errorMessage = '', shortcutAvailable = false;
let whisper;
let nativeInput, dictationWindow, dictationContext = null, dictationBusy = false, dictationShortcutAvailable = false, dictationLimit;
let preferences, holdAvailable = false, inputAvailable = false, holdMessage = '', watchedKey = null, holdPressed = false;
let dictationFeedback = null, hudTimer, tray, quitting = false, quitDeadline, escaped = false;
let armedInput = null, armedInputTimer;
let inputCommit = null;
let historyActions, shortcuts, screenAssistant, meetingReminder, reminderTimer;
const heldBindings = new Set();
function shortcutAction(action, pressed) {
  if (action === 'hold') { nativeEvent({ event: 'hold', pressed }); return; }
  if (!pressed) return;
  if (action === 'dictation') { clipboardTarget = 0; void toggleDictation(); }
  if (action === 'meeting') { if (status === 'idle') mainWindow.show(); publish('toggle-recording', null); }
  if (action === 'overlay') showOverlay(!overlay);
  if (action === 'capture') { if (dictationContext || mediaLibrary.pending.size || status === 'paused') return; mainWindow.show(); publish('open-capture', null); }
  if (action === 'clipboard') void openClipboard().catch(report);
}
function shortcutReadiness() {
  if (!shortcuts) return;
  holdAvailable = shortcuts.nativeAvailable && shortcuts.bindings.hold.length > 0;
  dictationShortcutAvailable = shortcuts.bindings.dictation.some(key => NATIVE.includes(key) ? shortcuts.nativeAvailable : globalShortcut.isRegistered(key));
  shortcutAvailable = shortcuts.bindings.meeting.some(key => NATIVE.includes(key) ? shortcuts.nativeAvailable : globalShortcut.isRegistered(key));
  publish('shortcuts', shortcuts.status()); publish('dictation-readiness', readiness());
}
let capturePaused = false, capturePausedAt = 0, capturePausedMs = 0;
let mediaLibrary, selectedCapture = null, captureSources = new Map();
let lastVoiceAt = 0, idleStopTimer, clipboardHistory, clipboardTimer, clipboardTarget = 0;
async function openClipboard() {
  if (status !== 'idle' || dictationContext || dictationBusy || inputCommit) { publish('notice', '请先结束会话或听写，再使用剪贴板快捷键。'); return; }
  const result = await nativeInput.request('capture', { excludePid: process.pid }).catch(() => ({ ok: false }));
  clipboardTarget = result.ok ? Date.now() + 60000 : 0;
  mainWindow.show(); mainWindow.focus(); publish('clipboard-page', null);
}
async function makeNotes(id, language = 'auto') {
  const settings = { ...store.settings }, route = routing(settings, true, false);
  return historyActions.makeNotes(id, (instructions, input, signal, options) => route.router.generate(instructions, input, signal, options), { settings, provider: route.engines.text, language });
}
function syncMedia(items) {
  const next = store.sessions.map(value => ({ ...value, mediaIds: items.filter(x => x.sessionId === value.id).map(x => x.id) }));
  store.sessions = next; // Media index is authoritative; rebuild these derived badges on startup.
  if (current) current.mediaIds = items.filter(x => x.sessionId === current.id).map(x => x.id);
  publish('media', items); publish('history', next); update();
}
function dataStats() {
  const size = file => { try { return fs.statSync(file).size; } catch { return 0; } };
  const partial = fs.readdirSync(mediaLibrary.directory).filter(name => /^[0-9a-f-]{36}\.part$/.test(name));
  const ocr = path.join(store.directory, 'ocr-models'), models = fs.existsSync(ocr) ? fs.readdirSync(ocr).filter(name => /^(eng|chi_sim|jpn)\.traineddata$/.test(name)) : [];
  const json = (name, count) => ({ count, bytes: size(path.join(store.directory, name)) });
  return { sessions: json('sessions.json', store.sessions.length), media: { count: mediaLibrary.items.length, bytes: mediaLibrary.items.reduce((n, x) => n + x.bytes, 0) }, clipboard: { count: clipboardHistory.items.length, bytes: clipboardHistory.status().bytes }, questions: json('screen-questions.json', screenAssistant.records.length), memories: json('screen-memory.json', screenAssistant.memories.length), partial: { count: partial.length, bytes: partial.reduce((n, name) => n + size(path.join(mediaLibrary.directory, name)), 0) }, ocr: { count: models.length, bytes: models.reduce((n, name) => n + size(path.join(ocr, name)), 0) } };
}
function sessionDuration(value = current) { return value ? Math.max(0, (value.pauseStartedAt || Date.now()) - value.startedAt - (value.pausedMs || 0)) : 0; }
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
  return { preferences, ...(shortcuts ? { holdBindings: shortcuts.bindings.hold, handsFreeBindings: shortcuts.bindings.dictation } : {}), holdAvailable, handsFreeAvailable: dictationShortcutAvailable, inputAvailable,
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
  if (shortcuts) {
    const signature = JSON.stringify(shortcuts.nativeBindings());
    if (watchedKey === signature && nativeInput.child && shortcuts.nativeAvailable) return;
    await nativeInput.request('watch', { key: 'off' });
    const result = await shortcuts.refreshNative(); watchedKey = signature; holdMessage = result.message || result.error || ''; shortcutReadiness(); return;
  }
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
  if (event.event === 'capture-key') { if (shortcuts?.showKeys) publish('capture-key', String(event.label || '').slice(0, 60)); return; }
  if (event.event === 'shortcut') { if (shortcuts?.nativeBindings()[event.key] !== event.action) return; if (event.action === 'hold') { if (event.pressed) heldBindings.add(event.key); else heldBindings.delete(event.key); shortcutAction('hold', heldBindings.size > 0); } else shortcutAction(event.action, event.pressed === true); return; }
  if (event.event === 'watch-error' || event.event === 'helper-error') {
    if (event.event === 'helper-error') inputAvailable = false;
    heldBindings.clear(); if (shortcuts) shortcuts.nativeAvailable = false;
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

function snapshot() { const capture = mediaLibrary?.pending.values().next().value; return { status, session: current, error: errorMessage, ...(capture ? { capture: { startedAt: capture.item.createdAt, paused: capturePaused, pausedMs: capturePausedMs, pausedAt: capturePausedAt } } : {}) }; }
function publish(type, payload) {
  for (const window of [mainWindow, overlay, dictationWindow, meetingToolbar]) if (window && !window.isDestroyed()) window.webContents.send('bridge:event', { type, payload });
}
function update() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if ((['recording', 'paused'].includes(status) && current?.mode !== 'dictation' && !current?.demo) || mediaLibrary?.pending.size) showMeetingToolbar();
    else meetingToolbar?.hide();
  }
  publish('session', snapshot());
}
function showMeetingToolbar() {
  if (!meetingToolbar || meetingToolbar.isDestroyed()) {
    const area = screen.getPrimaryDisplay().workArea;
    meetingToolbar = new BrowserWindow({ x: Math.round(area.x + (area.width - 360) / 2), y: area.y + 24, width: 360, height: 64, frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, show: false, focusable: false, backgroundColor: '#202623', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    secureWindow(meetingToolbar); meetingToolbar.once('ready-to-show', () => { if (['recording', 'paused'].includes(status) || mediaLibrary?.pending.size) meetingToolbar.showInactive(); }); load(meetingToolbar, '#toolbar');
  } else if (!meetingToolbar.isVisible()) meetingToolbar.showInactive();
}
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
  current.durationMs = sessionDuration();
  if (row.final) persist();
  update();
}
function trusted(event, overlayAllowed = false) {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (event.senderFrame !== event.sender.mainFrame || (window !== mainWindow && !(overlayAllowed && (window === overlay || window === dictationWindow || window === meetingToolbar)))) throw new Error('请求来源无效。');
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
  if (mediaLibrary?.pending.size) { publish('notice', '请先停止画面采集，再开始听写。'); return; }
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
  if (mediaLibrary?.pending.size) throw new Error('请先停止独立画面采集，再开始会议或听写。');
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
    status = 'recording'; if (!isDictation) current.startedAt = Date.now(); lastVoiceAt = Date.now(); persist(); update();
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
      current.endedAt = Date.now(); current.durationMs = sessionDuration(); current.status = finalStatus;
      if (current.pauseStartedAt) { current.pausedMs = (current.pausedMs || 0) + Date.now() - current.pauseStartedAt; delete current.pauseStartedAt; }
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
    if (!quitting && finalStatus === 'completed' && current && !current.demo && current.mode !== 'dictation' && store.settings.autoNotes && current.segments.some(x => x.final && x.text && !x.error)) {
      void makeNotes(current.id, store.settings.autoNotesLanguage).catch(error => publish('notice', '自动纪要未完成：' + error.message));
    }

    return snapshot();
  })();
  try { return await stopPromise; } finally { stopPromise = null; }
}

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'), safeStorage);
  mediaLibrary = new MediaLibrary(store, syncMedia);
  syncMedia(mediaLibrary.list());
  screenAssistant = new ScreenAssistant(store, { fork: utilityProcess.fork, media: mediaLibrary, onChange: value => publish('screen-data', value), onProgress: value => publish('ocr-progress', value) });
  protocol.handle('speakbridge-media', request => mediaLibrary.response(request));
  historyActions = new HistoryActions(store, {
    onNotesProgress: progress => publish('notes-progress', progress),
    isActive: id => current?.id === id && status !== 'idle',
    onChange: changed => {
      const ids = Array.isArray(changed) ? changed : [changed];
      if (current && ids.includes(current.id) && status === 'idle') { current = store.sessions.find(value => value.id === current.id) || null; update(); }
      syncMedia(mediaLibrary.list());
    },
  });
  whisper = new WhisperManager(path.join(store.directory, 'models'), progress => publish('model-progress', progress));
  preferences = dictationPreferences(store.read('dictation-settings.json', {}));
  nativeInput = new NativeInput(store.directory, { onEvent: nativeEvent });
  clipboardHistory = new ClipboardHistory(store, { clipboard, ClipboardItem,
    sequence: async () => { const value = await nativeInput.request('clipboard-sequence'); if (!value.ok || !Number.isFinite(value.sequence)) throw new Error('剪贴板组件不可用，请更新应用。'); return value.sequence; },
    blocked: () => !!(inputCommit || dictationContext || dictationBusy),
    onChange: (items, state) => publish('clipboard', { items, status: state }), onError: message => publish('notice', message),
  });
  meetingReminder = new MeetingReminder({ native: nativeInput, enabled: () => store.settings.meetingReminder, idle: () => status === 'idle' && !dictationContext && !dictationBusy,
    notify: name => { publish('meeting-reminder', name); if (Notification.isSupported()) { const notice = new Notification({ title: '是否需要记录会议？', body: name + ' 正在使用麦克风。点击打开声桥，确认后开始。' }); notice.on('click', () => { mainWindow.show(); mainWindow.focus(); }); notice.show(); } },
  });
  reminderTimer = setInterval(() => { void meetingReminder.poll(); }, 5000);
  clipboardTimer = setInterval(() => { void clipboardHistory.poll(); }, 900);
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
    const chosen = selectedCapture; selectedCapture = null;
    try { const sources = await desktopCapturer.getSources({ types: chosen ? ['screen', 'window'] : ['screen'], thumbnailSize: { width: 0, height: 0 } });
      const source = chosen && chosen.expires > Date.now() ? sources.find(x => x.id === chosen.id) : !chosen ? sources[0] : null;
      callback(source ? { video: source, ...(request.audioRequested ? { audio: 'loopback' } : {}) } : {});
    }
    catch { callback({}); }
  });
  handle('capture:sources', async kind => {
    if (!['screen', 'window'].includes(kind)) throw new Error('请选择全屏或窗口。');
    const sources = await desktopCapturer.getSources({ types: [kind], thumbnailSize: { width: 320, height: 180 } });
    captureSources = new Map(sources.map(x => [x.id, Date.now() + 60000]));
    return sources.map(x => ({ id: x.id, name: x.name, kind, thumbnail: x.thumbnail.toDataURL() }));
  });
  handle('capture:choose', id => { if (!captureSources.has(id) || captureSources.get(id) < Date.now()) throw new Error('画面选择已过期，请刷新后重选。'); selectedCapture = { id, expires: Date.now() + 30000 }; });
  handle('data:stats', dataStats);
  handle('data:clear', kind => {
    if (status !== 'idle' || dictationContext || dictationBusy || mediaLibrary.pending.size || screenAssistant.job) throw new Error('请先结束录制、输入与问答任务，再清理数据。');
    if (kind === 'sessions') { const ids = store.sessions.map(x => x.id); if (ids.length) { historyActions.deleteSessions(ids); mediaLibrary.detachSessions(ids); } }
    else if (kind === 'media') { if (mediaLibrary.items.length) mediaLibrary.delete(mediaLibrary.items.map(x => x.id)); }
    else if (kind === 'clipboard') { if (clipboardHistory.items.length) clipboardHistory.delete(clipboardHistory.items.map(x => x.id)); }
    else if (kind === 'questions' || kind === 'memories') { const key = kind === 'questions' ? 'records' : 'memories'; if (screenAssistant[key].length) screenAssistant.delete(key, screenAssistant[key].map(x => x.id)); }
    else if (kind === 'partial') { for (const name of fs.readdirSync(mediaLibrary.directory).filter(name => /^[0-9a-f-]{36}\.part$/.test(name))) fs.unlinkSync(path.join(mediaLibrary.directory, name)); }
    else if (kind === 'ocr') { const directory = path.join(store.directory, 'ocr-models'); if (fs.existsSync(directory)) for (const name of fs.readdirSync(directory).filter(name => /^(eng|chi_sim|jpn)\.traineddata$/.test(name))) fs.unlinkSync(path.join(directory, name)); }
    else throw new Error('无效的数据类别。');
    return dataStats();
  });
  handle('update:check', async () => {
    const response = await fetch('https://api.github.com/repos/aimasteracc/speakbridge/releases/latest', { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
    if (response.status === 404) return '目前还没有发布可下载的正式安装包。源码更新不等同于应用更新。';
    if (!response.ok) throw new Error('暂时无法检查更新，请稍后重试。');
    const release = await response.json(), version = String(release.tag_name || '').replace(/^v/, '');
    if (!/^\d+\.\d+\.\d+$/.test(version) || release.draft || release.prerelease) return '没有可用的正式版本。';
    const left = version.split('.').map(Number), right = app.getVersion().split('.').map(Number); const index = left.findIndex((n, i) => n !== right[i]); const newer = index >= 0 && left[index] > right[index];
    if (!newer) return '当前已是最新公开版本。';
    return '发现版本 ' + version + '。请到项目 GitHub Releases 页面查看安装说明。';
  });
  handle('screen:list' , () => screenAssistant.list());
  handle('screen:ocr', (id, language) => screenAssistant.ocr(id, language));
  handle('screen:cancel', () => screenAssistant.cancel());
  handle('screen:memory', text => screenAssistant.addMemory(text));
  handle('screen:delete', (kind, ids) => screenAssistant.delete(kind, ids));
  handle('screen:ask', input => { const route = routing(store.settings, true, false); return screenAssistant.ask(input, (instructions, text, signal, options) => route.router.generate(instructions, text, signal, options)); });
  handle('toolbar:action' , command => {
    if (status === 'idle' && mediaLibrary.pending.size) {
      if (command === 'stop') publish('stop-capture', null);
      else if (command === 'pause') { capturePaused = !capturePaused; if (capturePaused) capturePausedAt = Date.now(); else { capturePausedMs += Date.now() - capturePausedAt; capturePausedAt = 0; } publish('capture-pause', capturePaused); update(); }
      else throw new Error('画面已经在采集中。');
      return;
    }
    if (!['recording', 'paused'].includes(status) || current?.mode === 'dictation') throw new Error('当前没有进行中的会议。');
    if (!['pause', 'stop', 'capture'].includes(command)) throw new Error('无效操作。');
    if (command === 'capture') { if (mediaLibrary.pending.size) throw new Error('画面正在录制，可在主窗口停止。'); mainWindow.show(); mainWindow.focus(); publish('open-capture', null); }
    else publish('toolbar-action', command);
  }, true);
  handle('shortcuts:get' , () => shortcuts.status());
  handle('shortcuts:save', async bindings => {
    if (status !== 'idle' || dictationContext || dictationBusy || mediaLibrary.pending.size) throw new Error('请先结束录制，再修改快捷键。');
    const value = await shortcuts.save(bindings); watchedKey = null; shortcutReadiness(); return value;
  });
  handle('capture:keys', async enabled => {
    if (typeof enabled !== 'boolean') throw new Error('按键显示设置无效。');
    shortcuts.showKeys = enabled; const result = await shortcuts.refreshNative(); if (enabled && !result.available) { shortcuts.showKeys = false; throw new Error('显示按键需要辅助功能权限。'); }
  });
  handle('clipboard:list' , () => ({ items: clipboardHistory.list(), status: clipboardHistory.status() }));
  handle('clipboard:configure', enabled => clipboardHistory.configure(enabled));
  handle('clipboard:delete', ids => clipboardHistory.delete(ids));
  handle('clipboard:copy', async (id, paste) => {
    if (paste && (!clipboardTarget || Date.now() > clipboardTarget)) throw new Error('请先点击目标输入框，再用剪贴板快捷键打开历史；也可以复制后手动粘贴。');
    await clipboardHistory.copy(id);
    if (!paste) return '已按原格式复制';
    clipboardTarget = 0; mainWindow.hide();
    const result = await nativeInput.request('paste');
    if (!result.ok) { mainWindow.show(); throw new Error(result.error || '自动粘贴未确认，内容已复制。'); }
    return '已发出粘贴请求，请检查原输入框。';
  });
  handle('media:copy', async id => {
    if (inputCommit || dictationContext || dictationBusy) throw new Error('请先结束听写，再复制素材。');
    const item = mediaLibrary.find(id), file = mediaLibrary.file(item);
    await clipboard.write([new ClipboardItem(item.kind === 'image' ? { 'image/png': new Blob([await fs.promises.readFile(file)], { type: 'image/png' }) } : { 'text/uri-list': require('node:url').pathToFileURL(file).href + '\r\n' })]); return true;
  });
  handle('media:list' , sessionId => mediaLibrary.list(sessionId));
  handle('media:begin', input => {
    if (dictationContext) throw new Error('请先结束听写。');
    if (input?.sessionId && (input.sessionId !== current?.id || status !== 'recording' || current.demo)) throw new Error('请在真实会议录音进行时开始录屏。');
    capturePaused = false; capturePausedAt = 0; capturePausedMs = 0; const id = mediaLibrary.begin(input); update(); return id;
  });
  handle('media:append', (id, seq, bytes) => mediaLibrary.append(id, seq, bytes));
  handle('media:finish', (id, metadata) => { try { return mediaLibrary.finish(id, metadata); } catch (error) { mediaLibrary.abandon(id); update(); throw error; } });
  handle('media:abandon', id => { mediaLibrary.abandon(id); update(); return true; });
  handle('media:cancel', id => { const value = mediaLibrary.cancel(id); update(); return value; });
  handle('media:delete', ids => mediaLibrary.delete(ids));
  handle('media:export', async id => {
    const item = mediaLibrary.find(id), extension = item.mime === 'image/png' ? 'png' : item.mime === 'video/mp4' ? 'mp4' : 'webm';
    const result = await dialog.showSaveDialog(mainWindow, { defaultPath: `${item.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}.${extension}`, filters: [{ name: extension.toUpperCase(), extensions: [extension] }] });
    if (result.canceled || !result.filePath) return false;
    await fs.promises.copyFile(mediaLibrary.file(item), result.filePath); return true;
  });
  handle('bootstrap', () => ({ shortcuts: shortcuts?.status(), settings: store.publicSettings(), sessions: store.sessions, state: snapshot(), platform: process.platform, osVersion: os.release(), appVersion: app.getVersion(), shortcutAvailable, dictationShortcutAvailable, dictation: readiness(), dictationFeedback, dataDirectory: store.directory, capabilities: detect(store.settings, whisper) }), true);
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
  handle('session:pause', paused => {
    if (typeof paused !== 'boolean' || !['recording', 'paused'].includes(status) || current?.mode === 'dictation' || current.demo) throw new Error('当前会话不能暂停。');
    if (paused && status === 'recording') { current.durationMs = sessionDuration(); current.pauseStartedAt = Date.now(); status = 'paused'; }
    if (!paused && status === 'paused') { current.pausedMs = (current.pausedMs || 0) + Date.now() - current.pauseStartedAt; delete current.pauseStartedAt; status = 'recording'; lastVoiceAt = Date.now(); }
    current.status = status; persist(); update(); publish('capture-pause', paused); return snapshot();
  });
  handle('dictation:permission', async prompt => {
    if (status !== 'idle' || dictationContext || dictationBusy) throw new Error('请先结束当前会话。');
    return nativeInput.request('status', { prompt: prompt === true });
  });
  handle('dictation:status', prompt => dictationStatus(prompt === true));
  handle('dictation:warm', warmDictation);
  handle('dictation:preferences', async input => {
    if (status !== 'idle' || dictationContext || dictationBusy) throw new Error('请先结束听写，再修改快捷键。');
    const next = dictationPreferences(input);
    if (shortcuts) {
      const bindings = { ...shortcuts.bindings };
      if (next.holdKey !== preferences.holdKey) bindings.hold = next.holdKey === 'off' ? [] : [next.holdKey];
      if (next.handsFreeShortcut !== preferences.handsFreeShortcut) bindings.dictation = next.handsFreeShortcut === 'off' ? [] : [next.handsFreeShortcut];
      if (next.holdKey !== preferences.holdKey || next.handsFreeShortcut !== preferences.handsFreeShortcut) await shortcuts.save(bindings);
      store.write('dictation-settings.json', next); preferences = next; shortcutReadiness(); return readiness();
    }
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
    try { trusted(event); if (status !== 'recording' || !(data instanceof Uint8Array) || data.byteLength === 0 || data.byteLength > 48000 || data.byteLength % 2) return;
      const bytes = Buffer.from(data); let power = 0, count = 0;
      for (let i = 0; i < bytes.length; i += 32) { power += (bytes.readInt16LE(i) / 32768) ** 2; count++; }
      if (count && Math.sqrt(power / count) >= store.settings.speechThreshold) lastVoiceAt = Date.now();
      engine?.push(bytes);
    } catch (error) { report(error); }
  });
  handle('history:list', () => store.sessions);
  handle('history:delete', id => { const next = historyActions.deleteSession(id); mediaLibrary.detachSessions([id]); return next; });
  handle('history:delete-notes', id => historyActions.deleteNotes(id));
  handle('history:delete-many', ids => { const next = historyActions.deleteSessions(ids); mediaLibrary.detachSessions(ids); return next; });
  handle('history:delete-notes-many', ids => historyActions.deleteNotesMany(ids));
  handle('history:speaker', (id, segmentIds, speaker) => {
    const value = store.find(id);
    if (current?.id === id && status !== 'idle') throw new Error('请先结束会议，再编辑发言人。');
    if (!Array.isArray(segmentIds) || !segmentIds.length || new Set(segmentIds).size !== segmentIds.length || segmentIds.some(id => !value.segments.some(row => row.id === id)) || typeof speaker !== 'string' || speaker.length > 60 || /[\x00-\x1f]/.test(speaker)) throw new Error('发言人设置无效。');
    if (historyActions.notesStatus(id).state === 'running') throw new Error('纪要生成中，请稍后再修改发言人。');
    const next = { ...value, segments: value.segments.map(row => segmentIds.includes(row.id) ? { ...row, speaker: speaker.trim() } : row) };
    store.saveSession(next); publish('history', store.sessions); return next;
  });
  handle('history:update' , (id, patch) => {
    const value = { ...store.find(id) };
    if (typeof patch.title === 'string' && patch.title.trim() && patch.title.length <= 120) value.title = patch.title.trim();
    if (typeof patch.starred === 'boolean') value.starred = patch.starred;
    store.saveSession(value); return value;
  });
  handle('history:export', async (id, format) => {
    if (!['txt', 'md', 'srt', 'docx', 'pdf'].includes(format)) throw new Error('不支持的导出格式。');
    const value = store.find(id);
    const filename = value.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 70);
    const result = await dialog.showSaveDialog(mainWindow, { defaultPath: `${filename}.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] });
    if (result.canceled || !result.filePath) return false;
    if (format === 'docx') await fs.promises.writeFile(result.filePath, await documentDOCX(value));
    else if (format === 'pdf') {
      const print = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'speakbridge-print' } });
      secureWindow(print); print.webContents.session.setPermissionRequestHandler((_c, _p, done) => done(false));
      try { await print.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(await documentHTML(value))); const bytes = await print.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { top: .6, bottom: .6, left: .55, right: .55 } }); await fs.promises.writeFile(result.filePath, bytes); } finally { print.destroy(); }
    } else await fs.promises.writeFile(result.filePath, exportSession(value, format), 'utf8'); return true;
  });
  handle('history:copy', async id => { if (inputCommit) throw new Error('正在完成自动输入，请稍后复制。'); await clipboard.writeText(exportSession(store.find(id), 'txt')); return true; });
  handle('history:retry', async id => {
    let router;
    return historyActions.retryTranslation(id, (text, targetLanguage) => {
      router ||= routing({ ...store.settings, targetLanguage }, true, false).router;
      return router.translate(text);
    });
  });
  handle('history:notes', makeNotes);
  handle('history:notes-status', id => historyActions.notesStatus(id));
  handle('history:notes-cancel', id => historyActions.cancelNotes(id));
  handle('history:notes-plan', (id, language = 'auto') => {
    const provider = store.settings.textProvider === 'auto' && store.publicSettings().hasKey ? 'api' : store.settings.textProvider;
    return notesPlan(store.find(id), store.settings, provider, language);
  });
  handle('overlay:show', show => showOverlay(show === true));
  handle('overlay:hide', () => showOverlay(false), true);
  shortcuts = new Shortcuts(store, globalShortcut, nativeInput, shortcutAction, preferences);
  void shortcuts.initialize().then(shortcutReadiness).catch(report);
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
  mainWindow.on('closed', () => { overlay?.destroy(); dictationWindow?.destroy(); meetingToolbar?.destroy(); });
  app.on('activate', openMain);
  mainWindow.webContents.on('render-process-gone', () => {
    mediaLibrary.dispose(); if (shortcuts) { shortcuts.showKeys = false; void shortcuts.refreshNative().catch(() => {}); }
    cancelDictation();
    void stop('interrupted').catch(report).finally(() => { if (!quitting && !mainWindow.isDestroyed()) void load(mainWindow); });
  });
  powerMonitor.on('suspend', () => {
    if (dictationContext) cancelDictation();
    if (mediaLibrary?.pending.size) publish('capture-stop', null);
    if (status !== 'idle') { errorMessage = '系统进入休眠，会话已结束。'; publish('capture-stop', null); stop('interrupted').catch(report); }
  });
  load(mainWindow);
  idleStopTimer = setInterval(() => {
    if (status !== 'recording' || current?.demo || current?.mode === 'dictation' || !store.settings.idleStopMinutes) return;
    if (Date.now() - lastVoiceAt > store.settings.idleStopMinutes * 60000) { lastVoiceAt = Date.now(); publish('stop-request', '已达到设置的连续静音时间，会话将结束并保存。'); }
  }, 1000);
}).catch(error => { dialog.showErrorBox('声桥启动失败', error.message); app.quit(); });
app.on('before-quit', event => {
  if (quitting) return;
  if (inputCommit) {
    event.preventDefault(); quitting = true;
    // The helper must return after restoring the clipboard before shutdown.
    void inputCommit.promise.finally(() => app.quit()); return;
  }
  if (status !== 'idle' || dictationContext || mediaLibrary?.pending.size) {
    event.preventDefault(); quitting = true; cancelDictation(); publish('capture-stop', null);
    cancelInputContext(dictationContext);
    // Do not hold the OS exit open indefinitely for a slow model startup.
    quitDeadline = setTimeout(() => { nativeInput?.dispose(); whisper?.dispose(); mediaLibrary?.dispose(); app.exit(0); }, 15000);
    const drainMedia = async () => { const deadline = Date.now() + 12000; while (mediaLibrary?.pending.size && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100)); };
    void Promise.allSettled([stop('interrupted'), drainMedia()]).finally(() => { clearTimeout(quitDeadline); app.quit(); });
  } else quitting = true;
});
app.on('will-quit', () => { clearInterval(reminderTimer); screenAssistant?.cancel(); clearInterval(clipboardTimer); clearInterval(idleStopTimer); mediaLibrary?.dispose(); clearTimeout(hudTimer); tray?.destroy(); clearTimeout(dictationLimit); nativeInput?.dispose(); whisper?.dispose(); globalShortcut.unregisterAll(); });
app.on('window-all-closed', () => app.quit());
