const { parentPort, workerData } = require('./inference-port.cjs');
const path = require('node:path');
const { SpeechSegments } = require('./speech-segments.cjs');
try {
  const { Vad, LinearResampler } = require('sherpa-onnx-node');
  const resampler = new LinearResampler(24000, 16000);
  const threshold = workerData.threshold <= .006 ? .35 : workerData.threshold >= .025 ? .65 : .5;
  const vad = new Vad({ sileroVad: { model: path.join(workerData.cacheDir, 'vad/silero_vad.onnx'), threshold,
    minSilenceDuration: .1, minSpeechDuration: .08, maxSpeechDuration: 60, windowSize: 512 }, sampleRate: 16000, numThreads: 1, provider: 'cpu', debug: 0 }, 65);
  function send(segment) { parentPort.postMessage({ type: 'segment', ...segment }, [segment.audio.buffer]); }
  const segments = new SpeechSegments({ silenceMs: workerData.silenceMs, previewMs: workerData.previewMs, completeSentences: workerData.completeSentences, onSegment: send, onPreview: send });
  let pending = new Float32Array(0);
  function accept(audio, flush = false) {
    const merged = new Float32Array(pending.length + audio.length); merged.set(pending); merged.set(audio, pending.length);
    let offset = 0;
    for (; offset + 512 <= merged.length; offset += 512) {
      const frame = merged.subarray(offset, offset + 512); vad.acceptWaveform(frame);
      segments.push(frame, vad.isDetected());
      while (!vad.isEmpty()) vad.pop();
    }
    pending = merged.slice(offset);
    if (flush && pending.length) {
      const padded = new Float32Array(512); padded.set(pending); vad.acceptWaveform(padded);
      segments.push(pending, vad.isDetected()); pending = new Float32Array(0);
    }
  }
  parentPort.on('message', message => {
    try {
      if (message.type === 'audio') {
        const pcm = new Int16Array(message.pcm), samples = Float32Array.from(pcm, x => x / 32768);
        accept(resampler.resample(samples));
        parentPort.postMessage({ type: 'consumed', bytes: message.pcm.byteLength });
      } else if (message.type === 'flush') {
        accept(resampler.flush(new Float32Array(0)), true); segments.flush(); parentPort.postMessage({ type: 'flushed' });
      }
    } catch (error) { parentPort.postMessage({ type: 'fatal', error: error.message }); }
  });
  parentPort.postMessage({ type: 'ready' });
} catch (error) { parentPort.postMessage({ type: 'fatal', error: error.message }); }
