const WebSocket = require('ws');
const { cleanSpeechText } = require('./speech-text.cjs');
const ENDPOINT = 'wss://stt-rt.soniox.com/transcribe-websocket';
function sonioxConfig(settings) {
  return {
    model: 'stt-rt-v5', audio_format: 'pcm_s16le', sample_rate: 24000, num_channels: 1,
    enable_endpoint_detection: true,
    ...(settings.sourceLanguage !== 'auto' ? { language_hints: [settings.sourceLanguage] } : {}),
    ...(settings.dictionary.length ? { context: { terms: settings.dictionary } } : {}),
  };
}
class SonioxTranscriber {
  constructor({ settings, apiKey, translateText, onSegment, onFatal, onWarning, socketFactory = (url, options) => new WebSocket(url, options), drainMs = 25000 }) {
    Object.assign(this, { settings, apiKey, translateText, onSegment, onFatal, onWarning, socketFactory, drainMs });
    this.sequence = 0; this.rows = []; this.audioBytes = 0; this.jobs = []; this.running = 0;
    this.abort = new AbortController(); this.stopping = false; this.finished = false; this.disposed = false;
  }
  connect() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = error => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(); };
      const timer = setTimeout(() => { finish(new Error('Soniox 连接超时。')); this.socket?.terminate(); }, 15000);
      try { this.socket = this.socketFactory(ENDPOINT, { headers: { Authorization: `Bearer ${this.apiKey}` }, handshakeTimeout: 15000, maxPayload: 2 * 1024 * 1024 }); }
      catch (error) { finish(error); return; }
      this.socket.on('open', () => {
        // Soniox has no session-ready acknowledgement. Configuration is sent
        // before capture starts; an authentication/config error may arrive later.
        this.socket.send(JSON.stringify(sonioxConfig(this.settings)), error => finish(error));
      });
      this.socket.on('message', data => {
        if (this.disposed || this.failure) return;
        try {
          const event = JSON.parse(data.toString());
          if (event.error_code) throw new Error(`Soniox (${event.error_code})：${event.error_message || event.error_type || '服务异常'}`);
          this.receive(event);
        } catch (error) { if (!settled) finish(error); this.fail(error.message); }
      });
      this.socket.on('error', error => { if (!settled) finish(new Error('Soniox 连接失败：' + error.message)); else this.fail('Soniox 连接失败：' + error.message); });
      this.socket.on('close', () => {
        if (!settled) finish(new Error('Soniox 连接提前关闭。'));
        else if (!this.disposed && !this.finished && !(this.stopping && !this.audioBytes)) this.fail('Soniox 连接中断，已保留收到的文字。');
      });
    });
  }
  fail(message) {
    if (this.failure || this.disposed) return;
    if (this.apiKey) message = message.replaceAll(this.apiKey, '[已隐藏密钥]');
    this.failure = message;
    this.stopping ? this.onWarning(message) : this.onFatal(message);
  }
  push(pcm) {
    if (this.stopping || this.failure || this.finished || !pcm.length) return;
    if (this.socket?.readyState !== WebSocket.OPEN) return this.fail('Soniox 音频连接未就绪。');
    if (this.socket.bufferedAmount > 1024 * 1024) return this.fail('Soniox 网络发送积压，会话已停止，请检查连接。');
    this.audioBytes += pcm.length;
    // Preserve pauses as well as speech: semantic endpointing needs their timing.
    this.socket.send(pcm, { binary: true }, error => { if (error) this.fail('Soniox 音频发送失败。'); });
  }
  emit(row) { if (!this.disposed) this.onSegment({ ...row, text: cleanSpeechText(row.text) }); }
  ensureRow() {
    if (!this.current) {
      this.current = { id: 'soniox-' + ++this.sequence, startMs: 0, endMs: 0, text: '', translation: '', final: false };
      this.confirmed = ''; this.confirmedStart = null; this.confirmedEnd = 0; this.tail = '';
      this.rows.push(this.current);
    }
    return this.current;
  }
  receive(event) {
    if (this.finished) return;
    let tailStart = null, tailEnd = 0;
    if (Array.isArray(event.tokens)) {
      this.tail = '';
      for (const token of event.tokens) {
        if (typeof token.text !== 'string' || token.translation_status === 'translation') continue;
        if (token.text === '<end>' || token.text === '<fin>') {
          if (token.is_final) this.finalize();
          tailStart = null; tailEnd = 0; continue;
        }
        const row = this.ensureRow();
        const start = Number.isFinite(token.start_ms) ? token.start_ms : row.endMs;
        const end = Number.isFinite(token.end_ms) ? token.end_ms : start;
        if (token.is_final) {
          this.confirmed += token.text;
          this.confirmedStart ??= start; this.confirmedEnd = Math.max(this.confirmedEnd, end);
        } else { this.tail += token.text; tailStart ??= start; tailEnd = Math.max(tailEnd, end); }
        row.startMs = this.confirmedStart ?? tailStart ?? start;
        row.endMs = Math.max(this.confirmedEnd, tailEnd, row.startMs);
      }
      if (this.current) {
        this.current.text = this.confirmed + this.tail;
        this.current.startMs = this.confirmedStart ?? tailStart ?? this.current.startMs;
        this.current.endMs = Math.max(this.confirmedEnd, tailEnd, this.current.startMs);
        this.emit(this.current);
      }
    }
    if (event.finished) {
      this.finalize(); this.finished = true;
      if (!this.stopping) this.fail('Soniox 已结束音频流，请重新开始会话。');
    }
  }
  finalize(error) {
    const row = this.current; if (!row) return;
    // Only the active tail is revisable. Confirmed tokens are appended once.
    row.text = cleanSpeechText(this.confirmed + this.tail); row.final = true;
    if (error) row.error = error;
    this.emit(row); this.current = null; this.tail = '';
    if (row.text.trim() && !error && this.settings.targetLanguage !== 'off') {
      if (this.jobs.length >= 40) { row.translationError = '翻译积压，请结束后重试。'; this.emit(row); }
      else { this.jobs.push(row); this.pump(); }
    }
  }
  pump() {
    while (!this.disposed && this.running < 2 && this.jobs.length) {
      const row = this.jobs.shift(); this.running++;
      Promise.resolve().then(() => this.translateText(row.text, this.abort.signal))
        .then(text => { if (!this.disposed) row.translation = text; })
        .catch(error => { if (!this.disposed) row.translationError = error.message; })
        .finally(() => { this.running--; this.emit(row); this.pump(); });
    }
  }
  stop() { return this.stopPromise ||= this.drain(); }
  async drain() {
    this.stopping = true;
    if (!this.failure && this.socket?.readyState === WebSocket.OPEN && this.audioBytes) {
      // The API requires an empty TEXT frame. An empty binary frame is not EOF.
      this.socket.send('', { binary: false }, error => { if (error) this.fail('Soniox 收尾发送失败。'); });
      const deadline = Date.now() + this.drainMs;
      while (!this.finished && !this.failure && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
      if (!this.finished && !this.failure) this.fail('Soniox 定稿超时，已保留收到的文字。');
    }
    if (this.current) this.finalize(this.failure || '转写未确认，以下为部分文字。');
    const deadline = Date.now() + this.drainMs;
    while ((this.jobs.length || this.running) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    if (this.jobs.length || this.running) {
      this.onWarning('部分翻译未完成，可在历史记录中重试。');
      for (const row of this.rows) if (row.text && !row.translation && this.settings.targetLanguage !== 'off' && !row.error) { row.translationError = '翻译未完成，请重试。'; this.emit(row); }
    }
    this.jobs = []; this.disposed = true; this.abort.abort();
    this.socket?.close();
    const socket = this.socket;
    const timer = setTimeout(() => { if (socket && socket.readyState !== WebSocket.CLOSED) socket.terminate(); }, 1000); timer.unref();
  }
  async testConnection() {
    try { await this.connect(); this.push(Buffer.alloc(4800)); await this.stop(); if (this.failure || !this.finished) throw new Error(this.failure || 'Soniox 未确认测试音频。'); }
    finally { await this.stop(); }
  }
}
module.exports = { SonioxTranscriber, sonioxConfig, ENDPOINT };
