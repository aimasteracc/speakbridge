const { spawn } = require('node:child_process');
const path = require('node:path');
const { cleanSpeechText } = require('./speech-text.cjs');
const { CLEANUP_PROVIDERS } = require('./dictation-cleanup.cjs');
const SHORTCUT = 'CommandOrControl+Shift+D';
const HANDS_FREE_SHORTCUTS = [SHORTCUT, 'CommandOrControl+Alt+D', 'F8', 'off'];
function dictationPreferences(value = {}, platform = process.platform) {
  const keys = platform === 'darwin' ? ['fn', 'rightalt', 'rightctrl', 'off'] : ['rightalt', 'rightctrl', 'off'];
  // macOS reserves Fn for several system actions. Right Option also exists on
  // built-in MacBook keyboards (which often do not have a right Control key).
  const holdKey = value.holdKey ?? 'rightalt';
  const handsFreeShortcut = value.handsFreeShortcut ?? SHORTCUT;
  const cleanupProvider = value.cleanupProvider ?? 'off';
  if (!keys.includes(holdKey) || !HANDS_FREE_SHORTCUTS.includes(handsFreeShortcut)) throw new Error('请选择有效的听写快捷键。');
  if (!CLEANUP_PROVIDERS.includes(cleanupProvider)) throw new Error('请选择有效的听写整理方式。');
  return { holdKey, handsFreeShortcut, cleanupProvider };
}
function dictationSettings(settings) {
  return { ...settings, speechProvider: 'local', audioSource: 'microphone', targetLanguage: 'off', viewMode: 'transcript' };
}
function dictationText(rows) {
  return rows.filter(row => row.final && !row.error).map(row => cleanSpeechText(row.text || '')).filter(Boolean).join(' ')
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').replace(/ +/g, ' ').trim();
}
class NativeInput {
  constructor(directory, { platform = process.platform, launch = spawn, onEvent = () => {} } = {}) {
    this.directory = directory; this.platform = platform; this.launch = launch; this.pending = new Map(); this.sequence = 0;
    this.onEvent = onEvent;
  }
  async executable() {
    const base = path.join(__dirname.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep), 'native');
    if (this.platform === 'darwin') return path.join(base, 'dictation-mac-' + process.arch);
    if (this.platform !== 'win32') throw new Error('跨应用听写目前支持 macOS 和 Windows。');
    return path.join(base, 'dictation-win.exe');
  }
  async ready() {
    if (this.child) return;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const executable = await this.executable();
      const child = this.launch(executable, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false });
      this.child = child; let buffer = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', data => {
        buffer += data;
        if (buffer.length > 65536) return this.fail(new Error('系统输入服务返回异常。'), child);
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          try {
            const reply = JSON.parse(line);
            if (reply.event === 'hold' && typeof reply.pressed === 'boolean') { this.onEvent(reply); continue; }
            if (reply.event === 'watch-error') { this.onEvent(reply); continue; }
            const job = this.pending.get(reply.id);
            if (job) { this.pending.delete(reply.id); clearTimeout(job.timer); job.resolve(reply); }
          } catch { this.fail(new Error('系统输入服务返回异常。'), child); }
        }
      });
      child.stderr.on('data', () => {}); // Native diagnostics never enter transcript logs.
      child.stdin.on('error', () => this.fail(new Error('系统输入服务已断开。'), child));
      child.on('error', () => this.fail(new Error('系统输入组件无法启动，请重新安装或使用复制。'), child));
      child.on('exit', () => this.fail(new Error('系统输入服务已结束，文字已保留。'), child));
    })().finally(() => { this.starting = null; });
    return this.starting;
  }
  fail(error, child = this.child) {
    if (child !== this.child) return;
    this.child = null;
    for (const job of this.pending.values()) { clearTimeout(job.timer); job.reject(error); }
    this.pending.clear(); child?.kill();
    if (child) this.onEvent({ event: 'helper-error', message: '系统输入组件不可用：' + error.message });
  }
  async request(op, fields = {}) {
    await this.ready();
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => this.fail(new Error('系统输入超时，请检查目标输入框；文字已保留，未自动重试。')), 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ ...fields, op, id }) + '\n', error => { if (error) this.fail(error); });
    });
  }
  dispose() { this.fail(new Error('系统输入已取消。')); }
}
async function deliverDictation(session, native, context, finalStatus) {
  const rawText = dictationText(session.segments);
  // Explicit recovery reuses the result already shown, without a second AI call.
  const previous = session.dictation?.rawText === rawText ? session.dictation : null;
  const result = { text: previous?.text || rawText, rawText, ...(previous?.cleanup ? { cleanup: previous.cleanup } : {}), targetName: context.targetName || '', status: 'retained', message: '', retryable: false };
  const cancelled = () => context.cancelled || context.signal?.aborted || context.isCurrent?.() === false;
  const cancellation = () => ({ ...result, status: 'cancelled', message: '已取消听写，未输入文字。' });
  if (cancelled()) return cancellation();
  if (finalStatus !== 'completed' || session.segments.some(row => row.error || !row.final)) return { ...result, message: '识别未完整结束，未自动输入；请检查后复制。' };
  if (!rawText) return { ...result, status: 'empty', message: '没有识别到有效文字。' };
  // Target discovery runs alongside recording. Only the final write waits for
  // it; cancellation must not wait for a slow AX query or an old session.
  if (context.capture) {
    let onAbort;
    const aborted = new Promise(resolve => {
      onAbort = () => resolve(null);
      context.signal?.addEventListener('abort', onAbort, { once: true });
      if (context.signal?.aborted) onAbort();
    });
    let captured;
    try { captured = await Promise.race([context.capture, aborted]); }
    catch (error) { captured = { ok: false, error: error.message, diagnostics: { stage: 'capture', code: 'capture_failed' } }; }
    finally { context.signal?.removeEventListener('abort', onAbort); }
    if (cancelled()) return cancellation();
    result.targetName = captured?.appName || context.targetName || '';
    if (captured?.diagnostics) result.diagnostics = captured.diagnostics;
    if (!captured?.ok) return { ...result, retryable: true, message: captured?.error || '未能确认目标输入框，文字已保留。' };
  }
  if (context.diagnostics && !result.diagnostics) result.diagnostics = context.diagnostics;
  if (cancelled()) return cancellation();
  if (context.targetError) return { ...result, retryable: true, message: context.targetError };
  if (context.cleanup && !previous?.cleanup) {
    Object.assign(result, await context.cleanup(rawText));
    if (cancelled()) return cancellation();
    if (result.cleanup.status === 'failed') return { ...result, retryable: true, message: result.cleanup.message + '请检查后复制，或选择输入框填入原文。' };
  }
  try {
    // From this point the native operation owns its clipboard transaction.
    // Do not kill it or relabel its actual result as a cancelled operation.
    context.onWillInsert?.();
    const reply = await native.request('insert', { text: result.text });
    if (reply.diagnostics) result.diagnostics = reply.diagnostics;
    if (reply.ok) return { ...result, status: reply.verified === false ? 'sent' : 'inserted', message: reply.verified === false ? '已发出粘贴请求，请检查输入框，避免重复输入。' : '已输入到原输入框。' };
    return { ...result, retryable: reply.sent === 0, message: reply.error || '未能确认输入，文字已保留。' };
  } catch (error) { return { ...result, message: error.message }; }
}
module.exports = { SHORTCUT, NativeInput, dictationPreferences, dictationSettings, dictationText, deliverDictation };
