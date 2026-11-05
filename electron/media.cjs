const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');

const TYPES = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'image/png': 'png' };
const ID = /^[0-9a-f-]{36}$/;
const MAX_CHUNK = 16 * 1024 * 1024;
class MediaLibrary {
  constructor(store, onChange = () => {}) {
    this.store = store; this.onChange = onChange; this.pending = new Map();
    this.directory = path.join(store.directory, 'media'); fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    this.items = store.read('media.json', []);
    if (!Array.isArray(this.items)) throw new Error('媒体历史格式异常，请先备份。');
    // An interrupted recording is retained as a recoverable local file; never
    // present an unfinalized container as a successful recording.
  }
  list(sessionId) { return this.items.filter(x => !sessionId || x.sessionId === sessionId).map(x => ({ ...x, url: `speakbridge-media://asset/${x.id}`, posterUrl: x.poster ? `speakbridge-media://poster/${x.id}` : '' })); }
  find(id) { const item = this.items.find(x => x.id === id); if (!ID.test(id || '') || !item) throw new Error('素材不存在。'); return item; }
  file(item) { if (!ID.test(item.id) || !TYPES[item.mime]) throw new Error('无效的素材。'); return path.join(this.directory, item.id + '.' + TYPES[item.mime]); }
  save(next) { this.store.write('media.json', next); this.items = next; }
  changed() { try { this.onChange(this.list()); } catch { /* Index is authoritative; a UI refresh must not roll back a saved file. */ } }
  begin(input = {}) {
    const mime = String(input.mime || '').split(';')[0];
    if (!TYPES[mime]) throw new Error('不支持的录制格式。');
    if (this.pending.size) throw new Error('请先结束当前录制。');
    if (input.sessionId) this.store.find(input.sessionId);
    if (!['none', 'microphone', 'system', 'both', 'meeting'].includes(input.audio)) throw new Error('无效的录制音频来源。');
    const id = crypto.randomUUID(), temp = path.join(this.directory, id + '.part');
    const fd = fs.openSync(temp, 'wx', 0o600);
    this.pending.set(id, { fd, temp, bytes: 0, sequence: 0, item: { id, mime, kind: mime.startsWith('video/') ? 'video' : 'image', createdAt: Date.now(), title: String(input.title || '屏幕录制').slice(0, 120), sessionId: input.sessionId || '', startMs: Number.isFinite(input.startMs) ? Math.max(0, input.startMs) : 0, audio: input.audio } });
    return id;
  }
  append(id, sequence, bytes) {
    const job = this.pending.get(id);
    if (!job || sequence !== job.sequence) throw new Error('录制写入顺序异常，已停止保存。');
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > MAX_CHUNK) throw new Error('录制数据块无效或过大。');
    if (job.bytes + bytes.byteLength > 10 * 1024 ** 3) throw new Error('单段录制已达到 10 GB，请结束后重新开始。');
    // Synchronous bounded writes keep acknowledgements ordered and prevent the
    // renderer from building an unbounded in-memory recording.
    const data = Buffer.from(bytes); let written = 0;
    while (written < data.length) { const n = fs.writeSync(job.fd, data, written, data.length - written); if (!n) throw new Error('磁盘无法写入录制数据。'); written += n; }
    job.bytes += written; job.sequence++; return job.bytes;
  }
  finish(id, metadata = {}) {
    const job = this.pending.get(id); if (!job) throw new Error('录制已结束或已取消。');
    if (job.bytes < 12) throw new Error('没有收到有效的录制数据。');
    const head = Buffer.alloc(12); const read = fs.openSync(job.temp, 'r'); try { fs.readSync(read, head, 0, 12, 0); } finally { fs.closeSync(read); }
    const mime = job.item.mime;
    if ((mime === 'video/mp4' && head.toString('ascii', 4, 8) !== 'ftyp') || (mime === 'video/webm' && head.readUInt32BE(0) !== 0x1a45dfa3) || (mime === 'image/png' && head.toString('hex', 0, 8) !== '89504e470d0a1a0a')) throw new Error('录制文件与声明格式不符。');
    for (const key of ['durationMs', 'width', 'height']) if (!Number.isFinite(metadata[key]) || metadata[key] < 0 || metadata[key] > (key === 'durationMs' ? 86400000 : 16384)) throw new Error('无效的录制信息。');
    const item = { ...job.item, bytes: job.bytes, durationMs: Math.round(metadata.durationMs), width: Math.round(metadata.width), height: Math.round(metadata.height) };
    if (metadata.poster instanceof Uint8Array && metadata.poster.byteLength <= 2 * 1024 ** 2 && Buffer.from(metadata.poster).subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
      fs.writeFileSync(path.join(this.directory, id + '.poster.png'), metadata.poster, { mode: 0o600 }); item.poster = true;
    }
    fs.fsyncSync(job.fd); fs.closeSync(job.fd); job.fd = null;
    fs.renameSync(job.temp, this.file(item));
    try { this.save([item, ...this.items]); }
    catch (error) { fs.renameSync(this.file(item), job.temp); this.pending.delete(id); throw error; }
    this.pending.delete(id); this.changed(); return this.list().find(x => x.id === id);
  }
  abandon(id) { const job = this.pending.get(id); if (job?.fd != null) fs.closeSync(job.fd); this.pending.delete(id); if (ID.test(id || '') && !this.items.some(x => x.id === id)) fs.rmSync(path.join(this.directory, id + '.poster.png'), { force: true }); }
  cancel(id) { const job = this.pending.get(id); if (!job) return false; if (job.fd != null) fs.closeSync(job.fd); this.pending.delete(id); fs.rmSync(job.temp, { force: true }); fs.rmSync(path.join(this.directory, id + '.poster.png'), { force: true }); return true; }
  delete(ids) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 10000 || new Set(ids).size !== ids.length) throw new Error('请选择有效的素材。');
    const selected = ids.map(id => this.find(id));
    // Keep entries visible if a file cannot be removed, so deletion can be retried.
    for (const item of selected) { fs.rmSync(this.file(item), { force: true }); fs.rmSync(path.join(this.directory, item.id + '.poster.png'), { force: true }); }
    this.save(this.items.filter(x => !ids.includes(x.id))); this.changed(); return this.list();
  }
  detachSessions(ids) { this.save(this.items.map(x => ids.includes(x.sessionId) ? { ...x, sessionId: '' } : x)); this.changed(); }
  response(request) {
    try {
      const url = new URL(request.url), id = url.pathname.slice(1), item = this.find(id);
      if (!['asset', 'poster'].includes(url.hostname) || (url.hostname === 'poster' && !item.poster)) return new Response(null, { status: 404 });
      const file = url.hostname === 'poster' ? path.join(this.directory, id + '.poster.png') : this.file(item), size = fs.statSync(file).size;
      const range = request.headers.get('range'); let start = 0, end = size - 1;
      if (range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(range); if (!m || (!m[1] && !m[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
        if (!m[1]) start = Math.max(0, size - Number(m[2])); else { start = Number(m[1]); if (m[2]) end = Math.min(end, Number(m[2])); }
        if (!Number.isSafeInteger(start) || start > end || start < 0) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      }
      const headers = { 'Content-Type': url.hostname === 'poster' ? 'image/png' : item.mime, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) };
      return new Response(request.method === 'HEAD' ? null : Readable.toWeb(fs.createReadStream(file, { start, end })), { status: range ? 206 : 200, headers });
    } catch { return new Response(null, { status: 404 }); }
  }
  dispose() { for (const job of this.pending.values()) if (job.fd != null) fs.closeSync(job.fd); this.pending.clear(); }
}
module.exports = { MediaLibrary, MAX_CHUNK };
