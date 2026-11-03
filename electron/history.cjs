const { meetingNotesRequest, generateMeetingNotes } = require('./meeting-notes.cjs');
// History operations. A late provider response must never restore deleted
// content, and unrelated edits must survive a translation/notes response.
class HistoryActions {
  constructor(store, { isActive = () => false, onChange = () => {}, onNotesProgress = () => {} } = {}) {
    this.store = store; this.isActive = isActive; this.onChange = onChange; this.tasks = new Map();
    this.notesJobs = new Map(); this.onNotesProgress = onNotesProgress;
  }
  editable(id) {
    const value = this.store.find(id);
    if (this.isActive(id)) throw new Error('请先结束这条会话，再删除或修改记录。');
    return value;
  }
  deleteSession(id) {
    this.editable(id); this.store.deleteSession(id); this.tasks.delete(id); this.cancelNotes(id); this.notesJobs.delete(id); this.onChange(id);
    return this.store.sessions;
  }
  deleteNotes(id) {
    const value = { ...this.editable(id), notes: '' };
    if (value.notesError) value.notesError = '';
    this.store.saveSession(value);
    const tasks = this.tasks.get(id); tasks?.delete('notes'); if (tasks?.size === 0) this.tasks.delete(id);
    this.cancelNotes(id); this.notesJobs.delete(id);
    this.onChange(id); return value;
  }
  deleteMany(ids, notesOnly) {
    // Validate the entire selection before a single atomic write. A stale or
    // active ID must never leave a partially deleted batch.
    const records = this.store.findMany(ids);
    for (const record of records) this.editable(record.id);
    const selected = new Set(ids);
    const next = notesOnly
      ? this.store.sessions.map(row => selected.has(row.id) ? { ...row, notes: '', ...(row.notesError ? { notesError: '' } : {}) } : row)
      : this.store.sessions.filter(row => !selected.has(row.id));
    this.store.saveSessions(next);
    for (const id of selected) {
      this.cancelNotes(id); this.notesJobs.delete(id);
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
  notesStatus(id) {
    const value = this.store.find(id), job = this.notesJobs.get(id);
    return job?.status || { id, state: value.notesError ? 'failed' : 'idle', message: value.notesError || '', language: value.notesLanguage };
  }
  cancelNotes(id) {
    const job = this.notesJobs.get(id);
    if (!job || job.status.state !== 'running') return false;
    job.controller.abort(); return true;
  }
  async makeNotes(id, generate, options = {}) {
    const session = this.editable(id);
    meetingNotesRequest(session, options.language); // Validate before starting a job.
    return this.task(id, 'notes', async commit => {
      const job = { controller: new AbortController(), status: { id, state: 'running', startedAt: Date.now(), message: '正在准备资料…' } };
      this.notesJobs.set(id, job); let lastPublished = 0;
      const progress = update => {
        if (this.notesJobs.get(id) !== job) return;
        const changed = update.stage !== job.status.stage;
        job.status = { ...job.status, ...update };
        if (changed || Date.now() - lastPublished > 250 || job.status.state !== 'running') { lastPublished = Date.now(); this.onNotesProgress(job.status); }
      };
      progress({});
      try {
        const { notes, language } = await generateMeetingNotes(session, generate, { ...options, signal: job.controller.signal, onProgress: progress });
        const value = commit(latest => ({ ...latest, notes, notesLanguage: language, notesError: '', notesGeneratedAt: Date.now() }));
        progress({ state: 'completed', message: '纪要已生成并保存。', language }); return value;
      } catch (error) {
        const message = String(error.message || '纪要生成失败，请重试。').slice(0, 1000);
        // Keep the previous notes, and never resurrect a deleted/cancelled row.
        if (this.notesJobs.get(id) === job) {
          try { commit(latest => ({ ...latest, notesError: message })); } catch {}
          progress({ state: job.controller.signal.aborted ? 'cancelled' : 'failed', message });
        }
        throw error;
      }
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
