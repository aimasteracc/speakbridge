import { scrollOffset } from './scroll-capture';
import type { MediaAsset } from './types';
export type Crop = { x: number; y: number; width: number; height: number };
export type RecordingOptions = { sourceId: string; audio: 'none' | 'microphone' | 'system' | 'both' | 'meeting'; microphoneId?: string; sessionId?: string; startMs?: number; crop?: Crop; keys?: boolean };

// Capture is prepared before record() so users can inspect/crop without saving.
// All owned tracks and animation callbacks are released on every exit path.
export class ScreenRecording {
  stream?: MediaStream;
  video = document.createElement('video');
  private canvas = document.createElement('canvas');
  private recorder?: MediaRecorder;
  private context?: AudioContext;
  private owned: MediaStream[] = [];
  private output?: MediaStream;
  private frame = 0;
  private id = '';
  private queue: Promise<void> = Promise.resolve();
  private queuedBytes = 0;
  private sequence = 0;
  private failure?: Error;
  private started = 0;
  private pausedAt = 0;
  private pausedMs = 0;
  private stopping?: Promise<MediaAsset | null>;
  private disposed = false;
  private scrollPaused = false;
  private scrollTimer?: ReturnType<typeof setInterval>;
  private scrollCanvas?: HTMLCanvasElement;
  private scrollSample?: ImageData;
  private keyLabel = '';
  private keyUntil = 0;
  private removeKeys?: () => void;
  constructor(private onEnded: () => void, private onError: (message: string) => void) {}
  async prepare(options: RecordingOptions) {
    try {
      await window.speakbridge.chooseCaptureSource(options.sourceId);
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: 30 }, audio: ['system', 'both'].includes(options.audio) });
      this.owned.push(stream); this.stream = stream;
      if (this.disposed) throw new Error('录制已取消。');
      if (!stream.getVideoTracks().some(track => track.readyState === 'live')) throw new Error('没有获得可用画面，请重新选择窗口或屏幕。');
      if (['system', 'both'].includes(options.audio) && !stream.getAudioTracks().length) throw new Error('没有获得系统音频，请检查系统权限，或选择无音频录制。');
      this.video.srcObject = stream; this.video.muted = true; this.video.playsInline = true; await this.video.play();
      stream.getVideoTracks()[0].addEventListener('ended', () => { if (!this.disposed) this.onEnded(); });
    } catch (error) { this.dispose(); throw error; }
  }
  private async keepSourcePlaying() {
    // Removing a media element with the preview dialog pauses playback in Chromium.
    // Keep the source attached for the whole recording, independently of React.
    this.video.setAttribute('aria-hidden', 'true'); this.video.tabIndex = -1;
    this.video.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;pointer-events:none';
    document.body.append(this.video); await this.video.play();
  }
  async record(options: RecordingOptions, meetingAudio?: MediaStream) {
    if (!this.stream || this.disposed || this.recorder) throw new Error('请先选择可用的录制画面。');
    await this.keepSourcePlaying();
    const width = this.video.videoWidth, height = this.video.videoHeight;
    const crop = options.crop || { x: 0, y: 0, width: 1, height: 1 };
    if (![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) || crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > 1.001 || crop.y + crop.height > 1.001) throw new Error('请选择画面内的有效范围。');
    this.canvas.width = Math.max(2, Math.floor(width * crop.width / 2) * 2); this.canvas.height = Math.max(2, Math.floor(height * crop.height / 2) * 2);
    const context = this.canvas.getContext('2d')!;
    const draw = () => { if (this.disposed) return; context.drawImage(this.video, width * crop.x, height * crop.y, width * crop.width, height * crop.height, 0, 0, this.canvas.width, this.canvas.height);
      if (options.keys && Date.now() < this.keyUntil && this.keyLabel) { context.font = '24px sans-serif'; const w = Math.min(this.canvas.width - 24, context.measureText(this.keyLabel).width + 40); context.fillStyle = '#111d'; context.fillRect(12, this.canvas.height - 60, w, 48); context.fillStyle = '#fff'; context.fillText(this.keyLabel, 30, this.canvas.height - 27, Math.max(1, w - 30)); }
      this.frame = requestAnimationFrame(draw);
    }; draw(); this.output = this.canvas.captureStream(30);
    try {
      const audios: MediaStream[] = [];
      if (options.audio === 'meeting') { if (!meetingAudio?.getAudioTracks().some(t => t.readyState === 'live')) throw new Error('会议音频尚未就绪。'); audios.push(meetingAudio); }
      if (['system', 'both'].includes(options.audio)) audios.push(this.stream);
      if (['microphone', 'both'].includes(options.audio)) { const mic = await navigator.mediaDevices.getUserMedia({ audio: { ...(options.microphoneId ? { deviceId: { exact: options.microphoneId } } : {}), echoCancellation: true }, video: false }); this.owned.push(mic); audios.push(mic); }
      if (this.disposed) throw new Error('录制已取消。');
      if (audios.length) { this.context = new AudioContext(); const dest = this.context.createMediaStreamDestination(); for (const audio of audios) { const source = this.context.createMediaStreamSource(new MediaStream(audio.getAudioTracks())); const gain = this.context.createGain(); gain.gain.value = audios.length > 1 ? 0.7 : 1; source.connect(gain).connect(dest); } await this.context.resume(); dest.stream.getAudioTracks().forEach(t => this.output!.addTrack(t)); }
      const mimeType = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4'].find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error('当前运行环境不支持 MP4 编码，请更新声桥后重试。');
      this.recorder = new MediaRecorder(this.output, { mimeType, videoBitsPerSecond: 5000000 });
      this.id = await window.speakbridge.mediaBegin({ mime: mimeType, title: options.sessionId ? '会议画面' : '屏幕录制', audio: options.audio, sessionId: options.sessionId, startMs: options.startMs });
      this.recorder.ondataavailable = event => { if (!event.data.size) return; this.queuedBytes += event.data.size;
        if (this.queuedBytes > 64 * 1024 ** 2) { this.fail(new Error('磁盘写入跟不上录制速度，录制已停止。')); return; }
        this.queue = this.queue.then(async () => { if (this.failure) return; const data = new Uint8Array(await event.data.arrayBuffer()); for (let start = 0; start < data.length; start += 4 * 1024 ** 2) await window.speakbridge.mediaAppend(this.id, this.sequence++, data.subarray(start, start + 4 * 1024 ** 2)); }).catch(error => this.fail(error)).finally(() => { this.queuedBytes -= event.data.size; });
      };
      this.recorder.onerror = () => this.fail(new Error('视频编码失败，录制已停止。'));
      if (options.keys) await window.speakbridge.captureKeys(true);
      if (options.keys) this.removeKeys = window.speakbridge.onEvent(event => { if (event.type === 'capture-key' && typeof event.payload === 'string') { this.keyLabel = event.payload; this.keyUntil = Date.now() + 1200; } });
      this.started = Date.now(); this.recorder.start(1000);
    } catch (error) { if (this.id) await window.speakbridge.mediaCancel(this.id); this.dispose(); throw error; }
  }
  async recordScroll(options: RecordingOptions) {
    if (!this.stream || this.disposed) throw new Error('请先预览画面。');
    const crop = options.crop || { x: 0, y: 0, width: 1, height: 1 };
    if (crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > 1 || crop.y + crop.height > 1) throw new Error('截图范围无效。');
    await this.keepSourcePlaying();
    const scale = Math.min(1, 1920 / (this.video.videoWidth * crop.width));
    const frame = document.createElement('canvas'); frame.width = Math.round(this.video.videoWidth * crop.width * scale); frame.height = Math.round(this.video.videoHeight * crop.height * scale);
    const ctx = frame.getContext('2d', { willReadFrequently: true })!;
    const sample = () => { ctx.drawImage(this.video, this.video.videoWidth * crop.x, this.video.videoHeight * crop.y, this.video.videoWidth * crop.width, this.video.videoHeight * crop.height, 0, 0, frame.width, frame.height); return ctx.getImageData(0, 0, frame.width, frame.height); };
    this.scrollSample = sample(); this.scrollCanvas = document.createElement('canvas'); this.scrollCanvas.width = frame.width; this.scrollCanvas.height = frame.height; this.scrollCanvas.getContext('2d')!.drawImage(frame, 0, 0);
    this.id = await window.speakbridge.mediaBegin({ mime: 'image/png', title: '滚动长截图', audio: 'none' });
    this.scrollTimer = setInterval(() => {
      if (this.disposed || this.scrollPaused || !this.scrollCanvas || !this.scrollSample) return;
      const current = sample(), offset = scrollOffset(this.scrollSample, current);
      if (offset === null) { this.onError('滚动过快或画面无法对齐。请慢慢向下滚动，并让上下两次画面保留重叠。'); return; }
      if (!offset) return;
      const height = this.scrollCanvas.height + offset;
      if (height > 16384 || height * frame.width > 24000000) { this.onError('长截图已达到长度上限，正在保存。'); this.onEnded(); return; }
      const next = document.createElement('canvas'); next.width = frame.width; next.height = height;
      next.getContext('2d')!.drawImage(this.scrollCanvas, 0, 0); next.getContext('2d')!.drawImage(frame, 0, frame.height - offset, frame.width, offset, 0, height - offset, frame.width, offset);
      this.scrollCanvas = next; this.scrollSample = current;
    }, 1200);
  }
  private fail(error: Error) { if (this.failure) return; this.failure = error; this.onError(error.message); this.onEnded(); }
  pause(paused: boolean) { this.scrollPaused = paused; if (!this.recorder) return; if (paused && this.recorder.state === 'recording') { this.recorder.pause(); this.pausedAt = Date.now(); } else if (!paused && this.recorder.state === 'paused') { this.pausedMs += Date.now() - this.pausedAt; this.pausedAt = 0; this.recorder.resume(); } }
  async screenshot(crop: Crop = { x: 0, y: 0, width: 1, height: 1 }): Promise<MediaAsset> { if (!this.stream) throw new Error('请先选择画面。'); const canvas = document.createElement('canvas'); if (![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) || crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > 1 || crop.y + crop.height > 1) throw new Error('截图范围无效。'); canvas.width = Math.max(1, Math.round(this.video.videoWidth * crop.width)); canvas.height = Math.max(1, Math.round(this.video.videoHeight * crop.height)); canvas.getContext('2d')!.drawImage(this.video, this.video.videoWidth * crop.x, this.video.videoHeight * crop.y, this.video.videoWidth * crop.width, this.video.videoHeight * crop.height, 0, 0, canvas.width, canvas.height); const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/png')); const id = await window.speakbridge.mediaBegin({ mime: 'image/png', title: '屏幕截图', audio: 'none' }); try { const data = new Uint8Array(await blob.arrayBuffer()); for (let i = 0, seq = 0; i < data.length; i += 4 * 1024 ** 2) await window.speakbridge.mediaAppend(id, seq++, data.subarray(i, i + 4 * 1024 ** 2)); return await window.speakbridge.mediaFinish(id, { width: canvas.width, height: canvas.height, durationMs: 0 }); } catch (e) { await window.speakbridge.mediaCancel(id); throw e; } finally { this.dispose(); } }
  stop(): Promise<MediaAsset | null> {
    if (this.stopping) return this.stopping;
    this.stopping = (async () => {
      if (this.scrollCanvas && this.id) {
        clearInterval(this.scrollTimer);
        try { const canvas = this.scrollCanvas, blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png')); const data = new Uint8Array(await blob.arrayBuffer()); for (let i = 0, seq = 0; i < data.length; i += 4 * 1024 ** 2) await window.speakbridge.mediaAppend(this.id, seq++, data.subarray(i, i + 4 * 1024 ** 2)); return await window.speakbridge.mediaFinish(this.id, { width: canvas.width, height: canvas.height, durationMs: 0 }); } catch (error) { await window.speakbridge.mediaAbandon(this.id); throw error; } finally { this.dispose(); }
      }
      if (!this.recorder || !this.id) { this.dispose(); return null; }
      const durationMs = Date.now() - this.started - this.pausedMs - (this.pausedAt ? Date.now() - this.pausedAt : 0);
      try {
        if (this.recorder.state !== 'inactive') await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('视频编码结束超时，未完成文件保留在本机。')), 10000); this.recorder!.onstop = () => { clearTimeout(timer); resolve(); }; this.recorder!.stop(); });
        await this.queue;
        if (this.failure) throw this.failure;
        const poster = document.createElement('canvas'); poster.width = 640; poster.height = Math.max(1, Math.round(640 * this.canvas.height / this.canvas.width)); poster.getContext('2d')!.drawImage(this.canvas, 0, 0, poster.width, poster.height);
        const blob = await new Promise<Blob>(resolve => poster.toBlob(b => resolve(b!), 'image/png'));
        return await window.speakbridge.mediaFinish(this.id, { durationMs, width: this.canvas.width, height: this.canvas.height, poster: new Uint8Array(await blob.arrayBuffer()) });
      } catch (error) { await window.speakbridge.mediaAbandon(this.id); throw error; } finally { this.dispose(); }
    })(); return this.stopping;
  }
  dispose() { this.disposed = true; clearInterval(this.scrollTimer); this.scrollSample = undefined; cancelAnimationFrame(this.frame); if (this.removeKeys) { this.removeKeys(); void window.speakbridge.captureKeys(false).catch(() => {}); } this.owned.forEach(s => s.getTracks().forEach(t => t.stop())); this.output?.getTracks().forEach(t => t.stop()); void this.context?.close(); this.video.pause(); this.video.srcObject = null; this.video.remove(); }
}
