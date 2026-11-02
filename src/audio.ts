import type { Settings } from './types';
export class AudioCapture {
  private streams: MediaStream[] = [];
  private context?: AudioContext;
  private worklet?: AudioWorkletNode;
  private enabled = false;
  private stopped = false;
  private flushed?: () => void;
  constructor(private onChunk: (chunk: Uint8Array) => void, private onLevel: (level: number) => void, private onEnded: () => void) {}
  async prepare(settings: Settings) {
    try {
      if (settings.audioSource !== 'microphone') {
        const display = await navigator.mediaDevices.getDisplayMedia({ video: { width: 16, height: 16, frameRate: 1 }, audio: true });
        this.streams.push(display);
        const tracks = display.getAudioTracks();
        if (!tracks.length || tracks.some(track => track.readyState !== 'live')) throw new Error('没有可用的系统音频。请允许系统音频录制，并在共享窗口中启用音频；也可以改用麦克风。');
      }
      if (settings.audioSource !== 'system') this.streams.push(await navigator.mediaDevices.getUserMedia({ audio: { ...(settings.microphoneId ? { deviceId: { exact: settings.microphoneId } } : {}), echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }));
      if (this.stopped) { this.streams.forEach(stream => stream.getTracks().forEach(track => track.stop())); throw new Error('录音已取消。'); }
      this.context = new AudioContext({ sampleRate: 24000 });
      if (this.context.sampleRate !== 24000) throw new Error('当前设备不支持 24 kHz 音频采集。');
      await this.context.audioWorklet.addModule(new URL('pcm-worklet.js', document.baseURI).href);
      this.worklet = new AudioWorkletNode(this.context, 'pcm-recorder');
      this.worklet.port.onmessage = event => {
        if (event.data.flushed) { this.flushed?.(); return; }
        if (this.enabled) { this.onChunk(new Uint8Array(event.data.pcm)); this.onLevel(event.data.level); }
      };
      for (const stream of this.streams) {
        const audio = new MediaStream(stream.getAudioTracks());
        const input = this.context.createMediaStreamSource(audio);
        const gain = this.context.createGain(); gain.gain.value = this.streams.length > 1 ? .7 : 1;
        input.connect(gain).connect(this.worklet);
        stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => { if (!this.stopped) this.onEnded(); }));
      }
      const mute = this.context.createGain(); mute.gain.value = 0;
      this.worklet.connect(mute).connect(this.context.destination);
      await this.context.resume();
    } catch (error) {
      await this.stop();
      if (error instanceof DOMException && error.name === 'NotAllowedError') throw new Error('录音权限未开启。请在系统隐私设置中允许麦克风 / 系统音频录制，然后重试。');
      throw error;
    }
  }
  begin() { this.enabled = true; }
  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.worklet && this.enabled) await new Promise<void>(resolve => {
      const timeout = setTimeout(resolve, 200);
      this.flushed = () => { clearTimeout(timeout); resolve(); };
      this.worklet!.port.postMessage('flush');
    });
    this.enabled = false;
    this.streams.forEach(stream => stream.getTracks().forEach(track => track.stop()));
    this.worklet?.disconnect(); this.worklet?.port.close();
    await this.context?.close().catch(() => {});
    this.onLevel(0);
  }
}
