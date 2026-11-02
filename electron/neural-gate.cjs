const { InferenceProcess: Worker } = require('./inference-process.cjs');
const path = require('node:path');

class NeuralGate {
  constructor({ cacheDir, silenceMs, threshold, previewMs, completeSentences = false, onSegment, onFatal }) {
    Object.assign(this, { cacheDir, silenceMs, threshold, previewMs, completeSentences, onSegment, onFatal });
    this.pendingBytes = 0; this.closed = false; this.failed = false;
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.worker = new Worker(path.join(__dirname, 'vad-worker.cjs'), { workerData: { cacheDir: this.cacheDir, silenceMs: this.silenceMs, threshold: this.threshold, previewMs: this.previewMs, completeSentences: this.completeSentences } });
      this.initReject = reject;
      this.initTimer = setTimeout(() => this.fail(new Error('人声检测模型加载超时。')), 30000);
      this.worker.on('message', message => {
        if (message.type === 'ready') { clearTimeout(this.initTimer); this.initReject = null; resolve(); }
        if (message.type === 'consumed') this.pendingBytes -= message.bytes;
        if (message.type === 'segment' && !this.failed) this.onSegment(message);
        if (message.type === 'flushed') { this.flushResolve?.(); this.dispose(); }
        if (message.type === 'fatal') this.fail(new Error(message.error));
      });
      this.worker.on('error', error => this.fail(error));
      this.worker.on('exit', () => { if (!this.closed) this.fail(new Error('人声检测进程意外退出。')); });
    });
  }
  push(buffer) {
    if (this.closed || this.failed) return;
    this.pendingBytes += buffer.length;
    if (this.pendingBytes > 48000 * 45) return this.fail(new Error('音频处理积压超过 45 秒，会话已停止，请检查设备负载。'));
    const pcm = Uint8Array.from(buffer).buffer;
    this.worker.postMessage({ type: 'audio', pcm }, [pcm]);
  }
  flush() {
    if (this.closed || this.failed) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.flushResolve = resolve; this.flushReject = reject;
      this.flushTimer = setTimeout(() => this.fail(new Error('人声检测收尾超时，部分音频未能处理。')), 15000);
      this.worker.postMessage({ type: 'flush' });
    });
  }
  fail(error) {
    if (this.failed || this.closed) return;
    this.failed = true;
    const initializing = !!this.initReject;
    this.initReject?.(error); this.flushReject?.(error); this.dispose();
    if (!initializing) this.onFatal(error.message);
  }
  dispose() { this.closed = true; clearTimeout(this.initTimer); clearTimeout(this.flushTimer); if (this.worker) { void this.worker.terminate(); this.worker = null; } }
}
module.exports = { NeuralGate };
