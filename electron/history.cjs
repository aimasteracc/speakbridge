const { meetingNotesRequest } = require('./meeting-notes.cjs');
// History operations. A late provider response must never restore deleted
// content, and unrelated edits must survive a translation/notes response.
class HistoryActions {
  constructor(store, { isActive = () => false, onChange = () => {} } = {}) {
    this.store = store; this.isActive = isActive; this.onChange = onChange; this.tasks = new Map();
  }
  editable(id) {
    const value = this.store.find(id);
    if (this.isActive(id)) throw new Error('请先结束这条会话，再删除或修改记录。');
    return value;
  }
  deleteSession(id) {
    this.editable(id); this.store.deleteSession(id); this.tasks.delete(id); this.onChange(id);
    return this.store.sessions;
  }
  deleteNotes(id) {
    const value = { ...this.editable(id), notes: '' };
    this.store.saveSession(value);
    const tasks = this.tasks.get(id); tasks?.delete('notes'); if (tasks?.size === 0) this.tasks.delete(id);
    this.onChange(id); return value;
  }
  deleteMany(ids, notesOnly) {
    // Validate the entire selection before a single atomic write. A stale or
    // active ID must never leave a partially deleted batch.
    const records = this.store.findMany(ids);
    for (const record of records) this.editable(record.id);
    const selected = new Set(ids);
    const next = notesOnly
      ? this.store.sessions.map(row => selected.has(row.id) ? { ...row, notes: '' } : row)
      : this.store.sessions.filter(row => !selected.has(row.id));
    this.store.saveSessions(next);
    for (const id of selected) {
      if (!notesOnly) this.tasks.delete(id);
      else { const tasks = this.tasks.get(id); tasks?.delete('notes'); if (tasks?.size === 0) this.tasks.delete(id); }
    }
    this.onChange([...selected]);
    return this.store.sessions;
  }
  deleteSessions(ids) { return this.deleteMany(ids, false); }
  deleteNotesMany(ids) { return this.deleteMany(ids, true); }
  async task(id, kind, work) {
    this.editable(id);
    const tasks = this.tasks.get(id) || new Map();
    if (tasks.has(kind)) throw new Error('这条记录正在处理，请稍候。');
    const token = Symbol(kind); tasks.set(kind, token); this.tasks.set(id, tasks);
    const commit = patch => {
      if (this.tasks.get(id)?.get(kind) !== token) throw new Error('记录已删除或任务已取消，未保存迟到的结果。');
      const value = patch(this.editable(id));
      this.store.saveSession(value); this.onChange(id); return value;
    };
    try { return await work(commit); }
    finally {
      if (this.tasks.get(id)?.get(kind) === token) { tasks.delete(kind); if (!tasks.size) this.tasks.delete(id); }
    }
  }
  async makeNotes(id, generate) {
    const { instructions, input } = meetingNotesRequest(this.editable(id));
    return this.task(id, 'notes', async commit => {
      const notes = await generate(instructions, input);
      if (typeof notes !== 'string' || !notes.trim()) throw new Error('服务未返回完整纪要，原有内容已保留，请重试。');
      return commit(latest => ({ ...latest, notes }));
    });
  }
  async retryTranslation(id, translate) {
    const value = this.editable(id);
    if (value.demo) throw new Error('演示记录无需云端翻译。');
    if (value.targetLanguage === 'off') throw new Error('这次会话未启用翻译。');
    return this.task(id, 'translation', async commit => {
      for (const row of value.segments.filter(row => row.text && (!row.translation || row.translationError))) {
        let translation, failure;
        try { translation = await translate(row.text, value.targetLanguage); }
        catch (error) { failure = error; }
        commit(latest => ({ ...latest, segments: latest.segments.map(part => {
          if (part.id !== row.id || part.text !== row.text) return part;
          const next = { ...part };
          if (failure) next.translationError = failure.message;
          else { next.translation = translation; delete next.translationError; }
          return next;
        }) }));
        if (failure) throw failure;
      }
      return this.store.find(id);
    });
  }
}
module.exports = { HistoryActions };
