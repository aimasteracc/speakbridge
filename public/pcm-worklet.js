class PCMRecorder extends AudioWorkletProcessor {
  constructor() { super(); this.chunk = new Int16Array(2400); this.offset = 0; this.power = 0;
    this.port.onmessage = event => { if (event.data === 'flush') { this.flush(); this.port.postMessage({ flushed: true }); } };
  }
  flush() {
    if (!this.offset) return;
    const chunk = this.chunk.slice(0, this.offset);
    this.port.postMessage({ pcm: chunk.buffer, level: Math.sqrt(this.power / this.offset) }, [chunk.buffer]);
    this.offset = 0; this.power = 0;
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i] || 0;
      sample = Math.max(-1, Math.min(1, sample / channels.length));
      this.power += sample * sample;
      this.chunk[this.offset++] = Math.round(sample * (sample < 0 ? 32768 : 32767));
      if (this.offset === 2400) this.flush();
    }
    return true;
  }
}
registerProcessor('pcm-recorder', PCMRecorder);
