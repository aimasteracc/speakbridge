const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_SETTINGS, validateSettings } = require('./core.cjs');
class Store {
  constructor(directory, encryption) {
    this.directory = directory; this.encryption = encryption;
    fs.mkdirSync(directory, { recursive: true });
    this.settings = validateSettings({ ...DEFAULT_SETTINGS, ...this.read('settings.json', {}) });
    this.sessions = this.read('sessions.json', []);
    if (!Array.isArray(this.sessions)) throw new Error('历史记录格式异常，请先备份数据文件。');
    for (const session of this.sessions) if (!session.endedAt) {
      session.endedAt = new Date(session.startedAt).getTime() + (session.durationMs || 0);
      session.status = 'interrupted';
    }
    this.memoryKeys = new Map();
    this.canEncrypt = null;
  }
  read(name, fallback) {
    const file = path.join(this.directory, name);
    if (!fs.existsSync(file)) return fallback;
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { throw new Error(`${name} 无法读取。原文件已保留，请备份后修复。`); }
  }
  write(name, data) {
    const file = path.join(this.directory, name);
    fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
  }
  getKey(provider = 'api') {
    if (!['api', 'soniox'].includes(provider)) throw new Error('无效的密钥类型。');
    if (this.memoryKeys.has(provider)) return this.memoryKeys.get(provider);
    const stored = this.read(provider === 'soniox' ? 'soniox-credential.json' : 'credential.json', null);
    if (!stored) return '';
    try { return this.encryption.decryptString(Buffer.from(stored.encrypted, 'base64')); }
    catch { throw new Error(`无法解密 ${provider === 'soniox' ? 'Soniox ' : ''}API Key，请在设置中重新保存。`); }
  }
  publicSettings() {
    let hasKey = false, keyError = '', hasSonioxKey = false, sonioxKeyError = '';
    // Bootstrap must not unlock the keychain: even isEncryptionAvailable() can
    // synchronously prompt on macOS after an app update. Check saved metadata
    // here; decrypt only when an API route actually requests the credential.
    const configured = (provider, file) => this.memoryKeys.has(provider) ? !!this.memoryKeys.get(provider) : !!this.read(file, null)?.encrypted;
    try { hasKey = configured('api', 'credential.json'); } catch (e) { keyError = e.message; }
    try { hasSonioxKey = configured('soniox', 'soniox-credential.json'); } catch (e) { sonioxKeyError = e.message; }
    return { ...this.settings, hasKey, keyError, hasSonioxKey, sonioxKeyError, canEncrypt: this.canEncrypt };
  }
  saveSettings(input) {
    const settings = validateSettings(input);
    const updates = [];
    for (const [field, provider, file] of [['apiKey', 'api', 'credential.json'], ['sonioxApiKey', 'soniox', 'soniox-credential.json']]) {
      if (input[field] === undefined) continue;
      if (typeof input[field] !== 'string' || input[field].length > 4096 || /[\r\n\0]/.test(input[field])) throw new Error('无效的 API Key。');
      const key = input[field].trim();
      if (key) { this.canEncrypt = this.encryption.isEncryptionAvailable(); if (!this.canEncrypt) throw new Error('系统加密存储不可用，无法保存密钥。'); }
      updates.push({ file, provider, key, stored: key ? { encrypted: this.encryption.encryptString(key).toString('base64') } : null });
    }
    for (const { file, provider, key, stored } of updates) { this.write(file, stored); this.memoryKeys.set(provider, key); }
    this.write('settings.json', settings); this.settings = settings;
    return this.publicSettings();
  }
  saveSession(session) {
    const index = this.sessions.findIndex(s => s.id === session.id);
    const next = [...this.sessions];
    if (index < 0) next.unshift(session); else next[index] = session;
    this.write('sessions.json', next); this.sessions = next;
  }
  deleteSession(id) { this.find(id); const next = this.sessions.filter(s => s.id !== id); this.write('sessions.json', next); this.sessions = next; }
  saveSessions(next) { this.write('sessions.json', next); this.sessions = next; }
  findMany(ids) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 100000 || new Set(ids).size !== ids.length) throw new Error('请选择有效且不重复的记录。');
    return ids.map(id => this.find(id));
  }
  find(id) {
    if (typeof id !== 'string' || !id.trim() || id.length > 200) throw new Error('请选择一条有效的记录。');
    const value = this.sessions.find(s => s.id === id); if (!value) throw new Error('会话不存在。'); return value;
  }
}
module.exports = { Store };
