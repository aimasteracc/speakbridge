const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../electron/store.cjs');
const { HistoryActions } = require('../electron/history.cjs');

function fixture(t, options) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'speakbridge-history-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new Store(directory, {});
  for (const id of ['one', 'two']) store.saveSession({ id, title: id, startedAt: 1, endedAt: 2, status: 'completed', durationMs: 1,
    notes: '固定测试纪要 ' + id, demo: false, starred: false, targetLanguage: 'en',
    segments: [{ id: 'row-' + id, text: '固定测试文本 ' + id, translation: '', final: true }] });
  return { store, actions: new HistoryActions(store, options), reload: () => new Store(directory, {}) };
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test('notes errors survive restart; retry clears errors without losing the original transcript', async t => {
  const events = [], { store, actions, reload } = fixture(t, { onNotesProgress: value => events.push(value) });
  const original = structuredClone(store.find('one'));
  await assert.rejects(actions.makeNotes('one', async () => { throw Error('服务连接超时'); }), /超时/);
  const restarted = new HistoryActions(reload());
  assert.equal(restarted.notesStatus('one').state, 'failed');
  assert.match(restarted.notesStatus('one').message, /超时/);
  assert.equal(reload().find('one').notes, original.notes);
  await actions.makeNotes('one', async (_prompt, _input, _signal, options) => { options.onDelta('完整内容'); return '# 中文纪要'; });
  assert.equal(reload().find('one').notesError, '');
  assert.equal(reload().find('one').notesLanguage, 'zh');
  assert.deepEqual(reload().find('one').segments, original.segments);
  assert.ok(events.some(value => value.state === 'running'));
  assert.equal(events.at(-1).state, 'completed');
});
test('cancellation rejects a late successful result, preserves previous notes, and permits a fresh generation', async t => {
  const { store, actions } = fixture(t), response = deferred(), before = store.find('one').notes;
  let signal;
  const work = actions.makeNotes('one', (_prompt, _input, value) => { signal = value; return response.promise; });
  assert.equal(actions.notesStatus('one').state, 'running');
  assert.equal(actions.cancelNotes('one'), true); assert.equal(signal.aborted, true);
  response.resolve('late result'); await assert.rejects(work, /取消/);
  assert.equal(store.find('one').notes, before); assert.equal(actions.notesStatus('one').state, 'cancelled');
  await actions.makeNotes('one', async () => 'fresh result');
  assert.equal(store.find('one').notes, 'fresh result');
});

test('minutes follow Chinese source language and regeneration failure keeps previous notes', async t => {
  const { store, actions, reload } = fixture(t), before = store.find('one').notes;
  for (const generate of [async () => { throw Error('provider failed'); }, async () => '   ']) {
    await assert.rejects(actions.makeNotes('one', generate)); assert.equal(reload().find('one').notes, before);
  }
  await actions.makeNotes('one', async (instructions, input) => {
    assert.match(instructions, /## 7\. 会议总结/);
    assert.equal(JSON.parse(input).materials[0].content, '固定测试文本 one');
    return '# 新しい議事録';
  });
  assert.equal(reload().find('one').notes, '# 新しい議事録');
});

test('single delete persists and leaves all other records unchanged', t => {
  const { store, actions, reload } = fixture(t), other = structuredClone(store.find('two'));
  actions.deleteSession('one');
  assert.throws(() => store.find('one')); assert.throws(() => reload().find('one'));
  assert.deepEqual(reload().sessions, [other]);
});
test('notes-only deletion preserves transcription, translation, metadata and other notes after restart', t => {
  const { store, actions, reload } = fixture(t), before = structuredClone(store.sessions);
  actions.deleteNotes('one');
  assert.deepEqual(reload().sessions, before.map(row => row.id === 'one' ? { ...row, notes: '' } : row));
});
test('single-record APIs reject arrays, empty and missing identifiers', t => {
  const { store, actions } = fixture(t), before = JSON.stringify(store.sessions);
  for (const id of [['one', 'two'], [], undefined, null, {}, '', 'missing']) {
    assert.throws(() => actions.deleteSession(id)); assert.throws(() => actions.deleteNotes(id));
    assert.equal(JSON.stringify(store.sessions), before);
  }
});
test('batch deletion removes only explicit IDs with one write and one notification', t => {
  const changed = [], { store, actions, reload } = fixture(t, { onChange: ids => changed.push(ids) });
  store.saveSession({ ...store.find('two'), id: 'three', title: 'keep' });
  const keep = structuredClone(store.find('three'));
  const write = store.write.bind(store); let writes = 0;
  store.write = (...args) => { writes++; write(...args); };
  actions.deleteSessions(['one', 'two']);
  assert.equal(writes, 1); assert.deepEqual(changed, [['one', 'two']]);
  assert.deepEqual(store.sessions, [keep]); assert.deepEqual(reload().sessions, [keep]);
});
test('batch notes deletion preserves all originals and unselected notes after restart', t => {
  const { store, actions, reload } = fixture(t);
  store.saveSession({ ...store.find('two'), id: 'three' });
  const before = structuredClone(store.sessions);
  actions.deleteNotesMany(['one', 'two']);
  assert.deepEqual(reload().sessions, before.map(row => row.id === 'three' ? row : { ...row, notes: '' }));
});
test('invalid, duplicate, stale or active IDs reject the entire batch', t => {
  const { store, actions, reload } = fixture(t, { isActive: id => id === 'two' });
  const before = structuredClone(store.sessions);
  for (const ids of [null, {}, 'one', [], ['one', 'one'], ['one', null], ['one', 'missing'], ['one', 'two']]) {
    assert.throws(() => actions.deleteSessions(ids)); assert.throws(() => actions.deleteNotesMany(ids));
    assert.deepEqual(store.sessions, before); assert.deepEqual(reload().sessions, before);
  }
});
test('batch write failure preserves memory, disk, notifications and pending generation', async t => {
  const changed = [], { store, actions, reload } = fixture(t, { onChange: ids => changed.push(ids) });
  const before = structuredClone(store.sessions), response = deferred();
  const work = actions.makeNotes('one', () => response.promise);
  const write = store.write; store.write = () => { throw Error('disk unavailable'); };
  assert.throws(() => actions.deleteSessions(['one', 'two']), /disk/);
  assert.throws(() => actions.deleteNotesMany(['one', 'two']), /disk/);
  assert.deepEqual(store.sessions, before); assert.deepEqual(reload().sessions, before); assert.deepEqual(changed, []);
  store.write = write; response.resolve('new notes'); await work;
  assert.equal(reload().find('one').notes, 'new notes');
});
test('batch session deletion invalidates late notes and translations for every selected ID', async t => {
  const { actions, reload } = fixture(t), notes = deferred(), translation = deferred();
  const notesWork = actions.makeNotes('one', () => notes.promise), translationWork = actions.retryTranslation('two', () => translation.promise);
  actions.deleteSessions(['one', 'two']); notes.resolve('late notes'); translation.resolve('late translation');
  await assert.rejects(notesWork, /未保存/); await assert.rejects(translationWork, /未保存/);
  assert.deepEqual(reload().sessions, []);
});
test('batch notes deletion cancels generation but lets translation preserve cleared notes', async t => {
  const { actions, reload } = fixture(t), first = deferred(), second = deferred(), translation = deferred();
  const one = actions.makeNotes('one', () => first.promise), two = actions.makeNotes('two', () => second.promise);
  const translating = actions.retryTranslation('one', () => translation.promise);
  actions.deleteNotesMany(['one', 'two']); first.resolve('late'); second.resolve('late'); translation.resolve('translated');
  await assert.rejects(one, /未保存/); await assert.rejects(two, /未保存/); await translating;
  assert.ok(reload().sessions.every(row => row.notes === ''));
  assert.equal(reload().find('one').segments[0].translation, 'translated');
});
test('active record is protected while another record remains deletable', t => {
  const { store, actions } = fixture(t, { isActive: id => id === 'one' });
  assert.throws(() => actions.deleteSession('one'), /先结束/); assert.throws(() => actions.deleteNotes('one'), /先结束/);
  actions.deleteSession('two'); assert.equal(store.sessions.length, 1); assert.equal(store.find('one').notes, '固定测试纪要 one');
});
test('disk failure keeps both persisted and in-memory content, without reporting a change', t => {
  const changed = [], { store, actions, reload } = fixture(t, { onChange: id => changed.push(id) });
  const before = structuredClone(store.sessions); store.write = () => { throw Error('disk unavailable'); };
  assert.throws(() => actions.deleteSession('one'), /disk/); assert.throws(() => actions.deleteNotes('one'), /disk/);
  assert.deepEqual(store.sessions, before); assert.deepEqual(reload().sessions, before); assert.deepEqual(changed, []);
});
test('late generated notes cannot resurrect a deleted session', async t => {
  const { actions, reload } = fixture(t), response = deferred();
  const work = actions.makeNotes('one', () => response.promise);
  actions.deleteSession('one'); response.resolve('迟到的结果'); await assert.rejects(work, /未保存/);
  assert.throws(() => reload().find('one')); assert.equal(reload().sessions.length, 1);
});
test('notes deletion invalidates pending generation; a new generation still works', async t => {
  const { actions, reload } = fixture(t), old = deferred(), fresh = deferred();
  const oldWork = actions.makeNotes('one', () => old.promise);
  actions.deleteNotes('one'); const freshWork = actions.makeNotes('one', () => fresh.promise);
  old.resolve('旧结果'); await assert.rejects(oldWork, /未保存/);
  fresh.resolve('新生成纪要'); await freshWork; assert.equal(reload().find('one').notes, '新生成纪要');
});
test('late translation success or failure cannot resurrect a deleted record', async t => {
  const { actions, reload } = fixture(t);
  for (const [id, failure] of [['one', false], ['two', true]]) {
    const response = deferred(), work = actions.retryTranslation(id, () => response.promise);
    actions.deleteSession(id); if (failure) response.reject(Error('provider failed')); else response.resolve('translation');
    await assert.rejects(work, /未保存/);
  }
  assert.deepEqual(reload().sessions, []);
});
test('concurrent translation respects notes deletion and latest rename/star changes', async t => {
  const { store, actions, reload } = fixture(t), response = deferred();
  const work = actions.retryTranslation('one', () => response.promise);
  actions.deleteNotes('one'); store.saveSession({ ...store.find('one'), title: '新标题', starred: true });
  response.resolve('translated'); await work;
  const value = reload().find('one'); assert.equal(value.notes, ''); assert.equal(value.title, '新标题'); assert.equal(value.starred, true); assert.equal(value.segments[0].translation, 'translated');
});
