// All clocks are input sample clocks. A forced split carries one second of
// audio into the next window; text deduplication is applied ONLY to that window.
class SpeechSegments {
  constructor({ sampleRate = 16000, silenceMs = 700, maxMs = 24000, overlapMs = 1000, previewMs = 800, completeSentences = false, onSegment, onPreview }) {
    Object.assign(this, { sampleRate, silenceMs: completeSentences ? Math.max(1200, silenceMs) : silenceMs, maxMs, overlapMs, previewMs, completeSentences, onSegment, onPreview });
    this.position = 0; this.pre = []; this.preLength = 0; this.chunks = []; this.length = 0;
    this.active = false; this.silence = 0; this.voiced = 0; this.overlap = false; this.fresh = 0;
    this.segmentId = 0; this.nextPreview = 0;
  }
  push(samples, speech) {
    const frame = Float32Array.from(samples), ms = frame.length * 1000 / this.sampleRate;
    this.position += frame.length;
    if (!this.active) {
      this.pre.push(frame); this.preLength += frame.length;
      if (!speech) {
        while (this.preLength > this.sampleRate * .32 && this.pre.length > 1) this.preLength -= this.pre.shift().length;
        return;
      }
      this.active = true; this.chunks = this.pre; this.length = this.preLength; this.start = this.position - this.length;
      this.segmentId++; this.nextPreview = this.position + this.sampleRate * this.previewMs / 1000;
      this.pre = []; this.preLength = 0; this.voiced = ms; this.fresh = frame.length; this.silence = 0;
    } else {
      this.chunks.push(frame); this.length += frame.length; this.fresh += frame.length;
      this.voiced += speech ? ms : 0; this.silence = speech ? 0 : this.silence + ms;
    }
    const duration = this.length * 1000 / this.sampleRate;
    if (this.silence >= this.silenceMs || (!this.completeSentences && duration >= 12000 && this.silence >= 192)) this.emit(false);
    else if (duration >= this.maxMs) this.emit(true);
    else if (this.onPreview && this.position >= this.nextPreview) {
      this.nextPreview = this.position + this.sampleRate * this.previewMs / 1000;
      this.onPreview({ audio: this.audio(), startMs: this.start * 1000 / this.sampleRate, endMs: this.position * 1000 / this.sampleRate, overlap: this.overlap, segmentId: this.segmentId, preview: true });
    }
  }
  audio() {
    const audio = new Float32Array(this.length); let offset = 0;
    for (const chunk of this.chunks) { audio.set(chunk, offset); offset += chunk.length; }
    return audio;
  }
  emit(forced) {
    if (!this.active) return;
    const audio = this.audio();
    // The consumer may transfer/detach audio.buffer to another worker.
    const tail = forced ? audio.slice(-Math.round(this.overlapMs * this.sampleRate / 1000)) : null;
    if (this.voiced >= 96 && this.fresh > 0) this.onSegment({ audio, startMs: this.start * 1000 / this.sampleRate, endMs: this.position * 1000 / this.sampleRate, overlap: this.overlap, forced, segmentId: this.segmentId });
    if (forced) {
      this.chunks = [tail]; this.length = tail.length; this.start = this.position - tail.length;
      this.overlap = true; this.fresh = 0; this.voiced = 0; this.silence = 0;
      this.segmentId++; this.nextPreview = this.position + this.sampleRate * this.previewMs / 1000;
    } else {
      this.active = false; this.chunks = []; this.length = 0; this.overlap = false; this.silence = 0; this.voiced = 0; this.fresh = 0;
    }
  }
  flush() { this.emit(false); }
}
function trimOverlap(previous, current) {
  const normalized = text => Array.from(text.matchAll(/[\p{L}\p{N}]/gu), m => ({ char: m[0].toLowerCase(), end: m.index + m[0].length }));
  const a = normalized(previous).slice(-100), b = normalized(current);
  for (let n = Math.min(a.length, b.length, 80); n >= 2; n--) {
    if (!a.slice(-n).every((value, i) => value.char === b[i].char)) continue;
    const prefix = current.slice(0, b[n - 1].end);
    // A single English word may be a legitimate repetition. Require two words
    // or at least two CJK characters before removing a shared acoustic prefix.
    if ((prefix.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) || []).length < 2 && (prefix.match(/\p{L}+/gu) || []).length < 2) continue;
    return current.slice(b[n - 1].end).replace(/^[\s\p{P}]+/u, '');
  }
  return current;
}
module.exports = { SpeechSegments, trimOverlap };
