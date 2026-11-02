const { InferenceProcess: Worker } = require('./inference-process.cjs');
const path = require('node:path');
const fs = require('node:fs');
const { assetsInstalled, prepareAssets } = require('./model-assets.cjs');
const { NeuralGate } = require('./neural-gate.cjs');
const { trimOverlap } = require('./speech-segments.cjs');
const { cleanSpeechText } = require('./speech-text.cjs');

function validateLocalSpeech(settings) {
  if (['sensevoice', 'ensemble'].includes(settings.localModel) && !['auto', 'zh', 'ja', 'en', 'ko', 'yue'].includes(settings.sourceLanguage)) throw new Error('该语言请在设置中选择 Qwen3-ASR 或 Whisper；SenseVoice / 增强模式支持中、日、英、韩语。');
  // Reserve the finite decoder context for audio and output. Reject an oversized
  // prompt rather than silently letting the native decoder truncate speech.
  if (['qwen3-asr', 'ensemble'].includes(settings.localModel) && Buffer.byteLength((settings.dictionary || []).join(','), 'utf8') > 256) throw new Error('高精度识别的词典过长，请缩短至总计 256 字节以内（约 85 个汉字），优先保留重要名称。');
}
function resamplePcm(pcm) {
  // Exact 24 kHz -> 16 kHz area averaging. PCM samples are never written to disk.
  const count = Math.floor(pcm.length / 2 / 1.5), output = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const pos = i * 1.5, index = Math.floor(pos);
    const a = pcm.readInt16LE(index * 2) / 32768, b = pcm.readInt16LE((index + 1) * 2) / 32768;
    output[i] = i % 2 === 0 ? (a * 2 + b) / 3 : (a + b * 2) / 3;
  }
  return output;
}
class WhisperManager {
  constructor(cacheDir, onProgress = () => {}) {
    this.cacheDir = cacheDir; this.onProgress = onProgress; this.pending = new Map(); this.sequence = 0; this.ready = false; this.loading = null;
  }
  installed(model = 'sensevoice') { return assetsInstalled(this.cacheDir, model) && (model !== 'whisper-base' || fs.existsSync(path.join(this.cacheDir, '.whisper-ready.json'))); }
  async prepare(allowDownload = false, model = 'sensevoice', language = 'auto') {
    if (['sensevoice', 'ensemble'].includes(model) && !['auto', 'zh', 'ja', 'en', 'ko', 'yue'].includes(language)) throw new Error('SenseVoice / 增强模式支持中、日、英、韩语；其他语言请在设置中选择 Qwen3-ASR 或 Whisper。');
    const key = model + ':' + (['sensevoice', 'whisper-turbo', 'ensemble'].includes(model) ? language : 'auto');
    if (this.ready && this.readyKey === key && !allowDownload) return;
    if (this.loading) {
      if (this.loadingKey !== key) throw new Error('模型正在加载，请完成后再切换。');
      return this.loading;
    }
    if (!allowDownload && !this.installed(model)) throw new Error('请先在设置中下载 / 修复所选本地语音模型。');
    this.dispose(); this.loadingKey = key;
    fs.mkdirSync(this.cacheDir, { recursive: true });
    this.loading = (async () => {
      await prepareAssets(this.cacheDir, model, allowDownload, this.onProgress);
      return new Promise((resolve, reject) => {
      this.worker = new Worker(path.join(__dirname, 'whisper-worker.cjs'), { workerData: { cacheDir: this.cacheDir, allowDownload, model, language } });
      const worker = this.worker;
      const timer = setTimeout(() => { this.dispose(); reject(new Error('本地模型加载超时，请检查下载网络后重试。')); }, allowDownload ? 600000 : 90000);
      worker.on('message', message => {
        if (message.type === 'progress' && message.progress.status !== 'progress_total') this.onProgress(message.progress);
        if (message.type === 'ready') {
          clearTimeout(timer); this.ready = true; this.readyKey = key;
          if (model === 'whisper-base') fs.writeFileSync(path.join(this.cacheDir, '.whisper-ready.json'), JSON.stringify({ model: 'onnx-community/whisper-base', dtype: 'q8' }));
          this.onProgress({ status: 'ready' });
          resolve();
        }
        if (message.type === 'fatal') { clearTimeout(timer); reject(new Error('本地语音模型加载失败：' + message.error)); this.dispose(); }
        if (message.type === 'result') {
          const job = this.pending.get(message.id); if (!job) return;
          this.pending.delete(message.id); clearTimeout(job.timer);
          message.error ? job.reject(new Error(message.error)) : job.resolve(message.text);
        }
      });
      worker.on('error', error => { clearTimeout(timer); reject(error); if (this.worker === worker) { this.rejectPending(error); this.ready = false; } });
      worker.on('exit', code => {
        clearTimeout(timer); if (this.worker === worker) { this.ready = false; this.worker = null; }
        const error = new Error('本地识别进程已退出' + (code ? ` (${code})` : ''));
        reject(error); if (!this.worker || this.worker === worker) this.rejectPending(error);
      });
      });
    })().finally(() => { this.loading = null; });
    return this.loading;
  }
  transcribe(pcm, language) {
    return this.transcribeAudio(resamplePcm(pcm), language);
  }
  transcribeAudio(audio, language, dictionary = [], preview = false) {
    if (!this.ready) return Promise.reject(new Error('本地识别模型未就绪。'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('本地识别超过 60 秒，当前设备可能处理过慢。')); this.dispose(); }, 60000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, audio: audio.buffer, language, dictionary, preview }, [audio.buffer]);
    });
  }
  rejectPending(error) { for (const job of this.pending.values()) { clearTimeout(job.timer); job.reject(error); } this.pending.clear(); }
  dispose() { this.ready = false; const worker = this.worker; this.worker = null; if (worker) void worker.terminate(); this.rejectPending(new Error('本地识别已取消。')); }
}
class LocalTranscriber {
  constructor({ settings, manager, translateText, onSegment, onFatal, onWarning, Gate = NeuralGate, previewManager }) {
    Object.assign(this, { settings, manager, translateText, onSegment, onFatal, onWarning });
    this.queue = []; this.rows = []; this.sequence = 0; this.running = false; this.stopping = false; this.failed = false; this.cancelled = false; this.previousText = '';
    this.translations = new Set(); this.abort = new AbortController();
    // Enhanced final decoding must not block the next sentence's quick draft.
    this.previewManager = settings.localModel === 'ensemble' ? (previewManager || new WhisperManager(manager.cacheDir)) : null;
    this.previewQueue = []; this.previewRunning = false; this.finalQueued = new Set();
    this.gate = new Gate({ cacheDir: manager.cacheDir, threshold: settings.speechThreshold, silenceMs: settings.silenceMs, previewMs: ['sensevoice', 'ensemble'].includes(settings.localModel) ? 800 : 4000, completeSentences: ['qwen3-asr', 'whisper-turbo', 'ensemble'].includes(settings.localModel),
      onFatal: message => { this.failed = true; this.onFatal(message); },
      onSegment: ({ audio, startMs, endMs, overlap, forced, segmentId, preview = false }) => {
        if (this.failed || this.cancelled) return;
        const id = 'local-' + (segmentId ?? ++this.sequence);
        if (preview && (this.stopping || this.finalQueued.has(id))) return;
        // Keep only the newest queued draft for a sentence, never its oldest.
        this.queue = this.queue.filter(job => job.row.id !== id || !job.preview);
        this.previewQueue = this.previewQueue.filter(job => job.row.id !== id);
        if (!preview) this.finalQueued.add(id);
        let row = this.rows.find(row => row.id === id);
        if (!row) { row = { id, startMs, endMs, overlap, forced, text: '', translation: '', final: false, pending: 'recognizing' }; this.rows.push(row); }
        // Wait for meaningful text; rejected windows must not flash empty rows.
        if (this.queue.length >= 8) { row.error = '本地识别处理速度不足，会话已停止；这段语音未完成识别。'; row.final = true; delete row.pending; this.onSegment({ ...row }); this.failed = true; this.onFatal(row.error); return; }
        const job = { row, audio, preview, endMs, forced };
        if (preview && this.previewManager) { this.previewQueue.push(job); void this.pump(true); }
        else { this.queue.push(job); this.queue.sort((a, b) => Number(a.preview) - Number(b.preview)); void this.pump(); }
      },
    });
  }
  async connect() {
    validateLocalSpeech(this.settings);
    await this.manager.prepare(false, this.settings.localModel || 'sensevoice', this.settings.sourceLanguage);
    if (this.previewManager) await this.previewManager.prepare(false, 'sensevoice', this.settings.sourceLanguage);
    await this.gate.connect();
  }
  push(pcm) { if (!this.stopping && !this.failed) this.gate.push(pcm); }
  async pump(previewLane = false) {
    const running = previewLane ? 'previewRunning' : 'running';
    const queue = () => previewLane ? this.previewQueue : this.queue;
    const manager = previewLane ? this.previewManager : this.manager;
    if (this[running]) return; this[running] = true;
    try {
      while (queue().length && !this.cancelled) {
        const { row, audio, preview, endMs, forced } = queue().shift();
        if (row.final) continue;
        try {
          const text = cleanSpeechText(await manager.transcribeAudio(audio, this.settings.sourceLanguage, this.settings.dictionary, preview));
          if (this.cancelled || row.final) continue;
          row.text = cleanSpeechText(row.overlap ? trimOverlap(this.previousText, text) : text);
          if (!preview) this.previousText = text;
          row.endMs = endMs; row.forced = forced; row.final = !preview; delete row.pending;
          this.onSegment({ ...row });
          if (!preview && row.text && this.settings.targetLanguage !== 'off') {
            const job = this.translateText(row.text, this.abort.signal)
              .then(text => { row.translation = text; })
              .catch(error => { row.translationError = error.message; })
              .finally(() => { if (!this.cancelled) this.onSegment({ ...row }); this.translations.delete(job); });
            this.translations.add(job);
          }
        } catch (error) { if (this.cancelled) break; if (preview) continue; this.previousText = ''; row.error = error.message; row.final = true; delete row.pending; this.onSegment({ ...row }); this.onWarning(error.message); }
      }
    } finally { this[running] = false; }
  }
  async stop() {
    this.stopping = true;
    if (!this.failed) { try { await this.gate.flush(); } catch (error) { this.onWarning(error.message); } }
    this.gate.dispose();
    this.previewQueue = [];
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline && (this.running || this.queue.length || this.translations.size)) await new Promise(resolve => setTimeout(resolve, 40));
    if (this.running || this.queue.length || this.translations.size) {
      this.onWarning('部分本地任务尚未完成。已保存现有文本，翻译可稍后重试。');
      this.cancelled = true; this.queue = []; this.manager.dispose();
      for (const row of this.rows) { if (!row.final) { row.final = true; row.error = '识别未完成。'; delete row.pending; } if (row.text && !row.translation && this.settings.targetLanguage !== 'off') row.translationError = '翻译未完成，请重试。'; this.onSegment({ ...row }); }
    }
    // A VAD/process failure can leave a draft without any final job. Preserve it
    // as incomplete rather than letting the session layer silently call it final.
    this.cancelled = true;
    for (const row of this.rows) if (!row.final) { row.final = true; row.error = '识别未完成，以下为已收到的初稿。'; delete row.pending; this.onSegment({ ...row }); }
    this.abort.abort();
    this.previewManager?.dispose();
  }
}
module.exports = { WhisperManager, LocalTranscriber, resamplePcm, validateLocalSpeech };
