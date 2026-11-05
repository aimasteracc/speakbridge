const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const MAX_ITEM = 16 * 1024 ** 2, MAX_TOTAL = 128 * 1024 ** 2;
const PRIVATE = /concealed|transient|password|excludeclipboardcontentfrommonitorprocessing|canincludeinclipboardhistory/i;
class ClipboardHistory {
  constructor(store, { clipboard, ClipboardItem, sequence, onChange = () => {}, onError = () => {}, blocked = () => false }) {
    Object.assign(this, { store, clipboard, ClipboardItem, sequence, onChange, onError, blocked });
    this.directory = path.join(store.directory, 'clipboard'); fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    this.items = store.read('clipboard.json', []); this.enabled = store.read('clipboard-settings.json', {}).enabled === true;
    this.generation = 0; this.busy = false; this.lastSequence = undefined; this.writing = false;
    if (!Array.isArray(this.items)) throw new Error('剪贴板历史格式异常，请先备份。');
  }
  status() { return { enabled: this.enabled, count: this.items.length, bytes: this.items.reduce((n, x) => n + x.bytes, 0), limit: 200 }; }
  list() { return this.items.map(({ fingerprint, ...item }) => item); }
  file(id) { if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('剪贴板记录无效。'); return path.join(this.directory, id + '.json'); }
  save(items) { this.store.write('clipboard.json', items); this.items = items; try { this.onChange(this.list(), this.status()); } catch {} }
  async configure(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('剪贴板开关无效。');
    // Baseline before committing opt-in; failure leaves the prior setting intact.
    const counter = enabled ? await this.sequence() : undefined;
    this.store.write('clipboard-settings.json', { enabled }); this.enabled = enabled; this.generation++; this.lastSequence = counter;
    this.onChange(this.list(), this.status()); return this.status();
  }
  async poll() {
    if (!this.enabled || this.busy || this.writing) return;
    this.busy = true; const generation = this.generation;
    try {
      const counter = await this.sequence();
      if (this.lastSequence === undefined || this.blocked()) { this.lastSequence = counter; return; }
      if (counter === this.lastSequence) return;
      this.lastSequence = counter;
      const entries = await this.clipboard.read();
      if (!entries.length || entries.some(x => x.types.some(type => PRIVATE.test(type)))) return;
      let bytes = 0, text = '', image = '', kind = 'text'; const parts = [];
      for (const entry of entries) {
        const data = {};
        for (const type of entry.types) {
          const value = await entry.getType(type);
          if (type === 'electron application/bookmark') { data[type] = { bookmark: value }; bytes += Buffer.byteLength(JSON.stringify(value)); }
          else {
            if (value.size + bytes > MAX_ITEM) throw new Error('本次复制超过 16 MB，未加入历史；系统剪贴板不受影响。');
            const buffer = Buffer.from(await value.arrayBuffer()); bytes += buffer.length; data[type] = { bytes: buffer.toString('base64') };
            if (type === 'text/plain' && !text) text = buffer.toString('utf8').slice(0, 4000);
            if (type === 'text/uri-list') { kind = 'files'; text = buffer.toString('utf8').split(/\r?\n/).filter(x => x && !x.startsWith('#')).map(x => { try { return decodeURIComponent(new URL(x).pathname.split('/').at(-1)); } catch { return '文件'; } }).join('、').slice(0, 4000); }
            if (type === 'image/png' && !image && buffer.length <= 1024 ** 2) image = 'data:image/png;base64,' + data[type].bytes;
            if (kind !== 'files' && type.startsWith('image/')) kind = 'image';
            else if (kind === 'text' && /html|rtf/.test(type)) kind = 'rich';
          }
        }
        parts.push(data);
      }
      const currentSequence = await this.sequence();
      if (!bytes || bytes > MAX_ITEM || !this.enabled || generation !== this.generation || this.blocked() || counter !== currentSequence) return;
      const serialized = JSON.stringify(parts), fingerprint = crypto.createHash('sha256').update(serialized).digest('hex');
      if (this.items[0]?.fingerprint === fingerprint) return;
      const id = crypto.randomUUID(), item = { id, kind, text: text || (kind === 'image' ? '图片' : '剪贴板内容'), image, bytes, createdAt: Date.now(), fingerprint };
      fs.writeFileSync(this.file(id), serialized, { mode: 0o600, flag: 'wx' });
      let next = [item, ...this.items], total = next.reduce((n, x) => n + x.bytes, 0); const removed = [];
      while (next.length > 200 || total > MAX_TOTAL) { const old = next.pop(); removed.push(old); total -= old.bytes; }
      try { this.save(next); } catch (error) { fs.rmSync(this.file(id), { force: true }); throw error; }
      for (const old of removed) fs.rmSync(this.file(old.id), { force: true });
    } catch (error) { if (!this.lastErrorAt || Date.now() - this.lastErrorAt > 30000) { this.lastErrorAt = Date.now(); this.onError(error.message); } } finally { this.busy = false; }
  }
  async copy(id) {
    if (this.blocked()) throw new Error('正在完成听写输入，请稍后复制。');
    if (!this.items.some(x => x.id === id)) throw new Error('剪贴板记录不存在。');
    const parts = JSON.parse(fs.readFileSync(this.file(id), 'utf8'));
    const entries = parts.map(part => new this.ClipboardItem(Object.fromEntries(Object.entries(part).map(([type, value]) => [type, value.bookmark || new Blob([Buffer.from(value.bytes, 'base64')])]))));
    this.writing = true;
    try { await this.clipboard.write(entries); this.lastSequence = await this.sequence(); } finally { this.writing = false; }
    return true;
  }
  delete(ids) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 200 || new Set(ids).size !== ids.length || ids.some(id => !this.items.some(x => x.id === id))) throw new Error('请选择有效的剪贴板记录。');
    this.generation++; // A pending poll must not restore content after deletion.
    ids.forEach(id => fs.rmSync(this.file(id), { force: true })); this.save(this.items.filter(x => !ids.includes(x.id))); return this.list();
  }
}
module.exports = { ClipboardHistory };
