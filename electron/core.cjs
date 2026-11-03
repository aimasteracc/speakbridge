const SOURCES = ['microphone', 'system', 'both'];
const LANGUAGES = { zh: '简体中文', ja: '日本語', en: 'English', ko: '한국어', es: 'Español', fr: 'Français', de: 'Deutsch' };
const DEFAULT_SETTINGS = {
  speechProvider: 'auto', localModel: 'sensevoice', textProvider: 'auto', codexPath: '', claudePath: '', deepseekPath: '', deepseekHome: '',
  ollamaUrl: 'http://127.0.0.1:11434', ollamaModel: 'qwen2.5:7b', harnessPath: '', harnessArgs: '[]',
  baseUrl: 'https://api.openai.com/v1', transcriptionModel: 'gpt-live-transcribe',
  translationModel: 'gpt-4.1-mini', sourceLanguage: 'auto', targetLanguage: 'zh',
  audioSource: 'microphone', microphoneId: '', viewMode: 'transcript',
  silenceMs: 700, speechThreshold: 0.012, subtitleFontSize: 24, dictionary: [],
  notesContextTokens: 0, notesOutputTokens: 0, notesTimeoutSeconds: 600,
};
function validateSettings(input) {
  const result = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(result)) if (input[key] !== undefined) result[key] = input[key];
  if (!['auto', 'api', 'soniox', 'local'].includes(result.speechProvider) || !['auto', 'api', 'codex', 'claude', 'deepseek', 'ollama', 'harness'].includes(result.textProvider)) throw new Error('无效的 AI 引擎。');
  if (!['sensevoice', 'whisper-base', 'qwen3-asr', 'whisper-turbo', 'ensemble'].includes(result.localModel)) throw new Error('无效的本地语音模型。');
  for (const key of ['codexPath', 'claudePath', 'deepseekPath', 'deepseekHome', 'harnessPath']) if (typeof result[key] !== 'string' || result[key].length > 1000 || /[\0\r\n]/.test(result[key])) throw new Error('无效的程序路径。');
  if (result.deepseekHome && !require('node:path').isAbsolute(result.deepseekHome)) throw new Error('DeepSeek Harness 配置目录须为绝对路径。');
  const ollama = new URL(result.ollamaUrl);
  if (!['http:', 'https:'].includes(ollama.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(ollama.hostname) || ollama.username || ollama.password || ollama.search || ollama.hash) throw new Error('Ollama 地址必须是本机 HTTP / HTTPS 地址。');
  result.ollamaUrl = result.ollamaUrl.replace(/\/+$/, '');
  if (typeof result.ollamaModel !== 'string' || !/^[\w.:/-]{1,150}$/.test(result.ollamaModel)) throw new Error('无效的 Ollama 模型名称。');
  let args; try { args = JSON.parse(result.harnessArgs); } catch { throw new Error('Harness 参数须为 JSON 字符串数组。'); }
  if (!Array.isArray(args) || args.length > 30 || args.some(x => typeof x !== 'string' || x.length > 1000 || x.includes('\0'))) throw new Error('无效的 Harness 参数。');
  const url = new URL(result.baseUrl);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw new Error('服务地址必须使用 HTTPS，本机服务可使用 HTTP。');
  result.baseUrl = result.baseUrl.replace(/\/+$/, '');
  for (const key of ['transcriptionModel', 'translationModel']) if (typeof result[key] !== 'string' || !/^[a-zA-Z0-9._:/-]{1,150}$/.test(result[key])) throw new Error('请输入有效的模型名称。');
  if (!SOURCES.includes(result.audioSource)) throw new Error('无效的音频来源。');
  if (!['auto', ...Object.keys(LANGUAGES)].includes(result.sourceLanguage) || !['off', ...Object.keys(LANGUAGES)].includes(result.targetLanguage)) throw new Error('无效的语言。');
  if (!['transcript', 'subtitle'].includes(result.viewMode)) throw new Error('无效的显示模式。');
  if (typeof result.microphoneId !== 'string' || result.microphoneId.length > 300) throw new Error('无效的麦克风。');
  if (!Number.isFinite(result.silenceMs) || result.silenceMs < 300 || result.silenceMs > 2000) throw new Error('静音间隔必须为 300–2000 毫秒。');
  if (!Number.isFinite(result.speechThreshold) || result.speechThreshold < .003 || result.speechThreshold > .1) throw new Error('无效的语音阈值。');
  if (!Number.isFinite(result.subtitleFontSize) || result.subtitleFontSize < 16 || result.subtitleFontSize > 40) throw new Error('字幕字号必须为 16–40。');
  if (!Array.isArray(result.dictionary) || result.dictionary.length > 100 || result.dictionary.some(x => typeof x !== 'string' || !x.trim() || x.length > 80 || /[<>\r\n]/.test(x))) throw new Error('词典最多 100 项，每项最多 80 字，不含换行或尖括号。');
  result.dictionary = [...new Set(result.dictionary.map(x => x.trim()))];
  for (const key of ['notesContextTokens', 'notesOutputTokens']) {
    if (!Number.isSafeInteger(result[key]) || result[key] < 0 || result[key] > 10000000 || (result[key] > 0 && result[key] < 1024)) throw new Error('纪要 token 预算须为 0（自动）或 1,024–10,000,000 的整数。');
  }
  if (!Number.isInteger(result.notesTimeoutSeconds) || result.notesTimeoutSeconds < 30 || result.notesTimeoutSeconds > 1800) throw new Error('纪要请求超时须为 30–1800 秒。');
  return result;
}
function realtimeConfig(settings) {
  const transcription = { model: settings.transcriptionModel };
  if (settings.transcriptionModel.startsWith('gpt-live-transcribe')) {
    transcription.delay = 'low';
    if (settings.sourceLanguage !== 'auto') transcription.languages = [settings.sourceLanguage];
    if (settings.dictionary.length) transcription.keywords = settings.dictionary;
  } else {
    if (settings.sourceLanguage !== 'auto') transcription.language = settings.sourceLanguage;
    if (settings.dictionary.length) transcription.prompt = settings.dictionary.join(', ');
  }
  return { type: 'session.update', session: { type: 'transcription', audio: { input: { format: { type: 'audio/pcm', rate: 24000 }, transcription, turn_detection: null } } } };
}
function timestamp(ms, srt = false) {
  const n = Math.max(0, Math.round(ms));
  const h = String(Math.floor(n / 3600000)).padStart(2, '0');
  const m = String(Math.floor(n / 60000) % 60).padStart(2, '0');
  const s = String(Math.floor(n / 1000) % 60).padStart(2, '0');
  return srt ? `${h}:${m}:${s},${String(n % 1000).padStart(3, '0')}` : `${h}:${m}:${s}`;
}
function exportSession(session, format) {
  const segments = [...session.segments].sort((a, b) => a.startMs - b.startMs).filter(s => s.text.trim());
  if (format === 'srt') return segments.map((s, i) => `${i + 1}\n${timestamp(s.startMs, true)} --> ${timestamp(Math.max(s.startMs + 500, s.endMs), true)}\n${[s.text, s.translation].filter(Boolean).join('\n')}`).join('\n\n') + '\n';
  const body = segments.map(s => `[${timestamp(s.startMs)}] ${s.text}${s.translation ? '\n' + s.translation : ''}`).join('\n\n');
  return `${format === 'md' ? '# ' : ''}${session.title}${session.demo ? ' [演示]' : ''}\n${new Date(session.startedAt).toLocaleString('zh-CN')}\n\n${body}\n${session.notes ? '\n会议纪要\n' + session.notes : ''}`;
}
// PCM clock is independent of network timing. Keep 300 ms of pre-roll, commit
// after a speech pause, and split continuous speech at 8 s to bound translation delay.
class VoiceGate {
  constructor({ threshold = .012, silenceMs = 700, onAudio, onCommit }) {
    Object.assign(this, { threshold, silenceMs, onAudio, onCommit });
    this.position = 0; this.active = false; this.pre = []; this.preMs = 0; this.silence = 0; this.start = 0;
  }
  push(buffer) {
    let power = 0;
    for (let i = 0; i < buffer.length; i += 2) power += (buffer.readInt16LE(i) / 32768) ** 2;
    const rms = Math.sqrt(power / (buffer.length / 2));
    const duration = buffer.length / 48;
    this.position += duration;
    if (!this.active) {
      this.pre.push(buffer); this.preMs += duration;
      if (rms < this.threshold) {
        while (this.preMs > 300 && this.pre.length > 1) this.preMs -= this.pre.shift().length / 48;
        return;
      }
      this.active = true; this.start = this.position - this.preMs; this.silence = 0;
      for (const chunk of this.pre) this.onAudio(chunk);
      this.pre = []; this.preMs = 0;
    } else this.onAudio(buffer);
    this.silence = rms < this.threshold ? this.silence + duration : 0;
    if (this.silence >= this.silenceMs || this.position - this.start >= 8000) this.flush();
  }
  flush() {
    if (this.active) this.onCommit({ startMs: this.start, endMs: this.position });
    this.active = false; this.silence = 0; this.pre = []; this.preMs = 0;
  }
}
module.exports = { DEFAULT_SETTINGS, LANGUAGES, validateSettings, realtimeConfig, exportSession, timestamp, VoiceGate };
