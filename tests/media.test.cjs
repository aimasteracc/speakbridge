const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../electron/store.cjs');
const { MediaLibrary } = require('../electron/media.cjs');
function fixture(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'speakbridge-media-test-')); const store = new Store(dir, {}); const media = new MediaLibrary(store); t.after(() => { media.dispose(); fs.rmSync(dir, { recursive: true, force: true }); }); return { store, media, dir }; }
const data = Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex');
const metadata = { durationMs: 1000, width: 640, height: 360 };
test('recordings require ordered chunks, persist independently and serve seek ranges', async t => {
  const { store, media } = fixture(t); store.saveSession({ id: 'meeting', startedAt: Date.now(), endedAt: Date.now(), segments: [] });
  const id = media.begin({ mime: 'video/mp4', audio: 'meeting', sessionId: 'meeting', startMs: 2500 });
  media.append(id, 0, data.subarray(0, 12)); assert.throws(() => media.append(id, 0, data), /顺序/); media.append(id, 1, data.subarray(12));
  const item = media.finish(id, metadata); assert.equal(item.bytes, data.length); assert.equal(item.startMs, 2500);
  const restarted = new MediaLibrary(store); assert.equal(restarted.list('meeting').length, 1);
  const response = restarted.response(new Request(item.url, { headers: { Range: 'bytes=4-7' } })); assert.equal(response.status, 206); assert.equal(await response.text(), 'ftyp');
  assert.equal(restarted.response(new Request(item.url, { headers: { Range: 'bytes=999-' } })).status, 416);
  assert.equal(restarted.response(new Request('speakbridge-media://asset/../../settings.json')).status, 404);
  assert.throws(() => media.delete([id, 'missing']), /不存在/); assert.equal(media.list().length, 1);
  media.delete([id]); assert.equal(store.sessions.length, 1); assert.equal(media.list().length, 0); assert.equal(media.response(new Request(item.url)).status, 404);
});
test('invalid content is never marked complete and cancellation removes pending bytes', t => {
  const { media, dir } = fixture(t); assert.throws(() => media.begin({ mime: 'video/mp4', audio: 'none', sessionId: 'missing' }));
  const id = media.begin({ mime: 'video/mp4', audio: 'none' }); media.append(id, 0, Buffer.from('not an mp4 file at all'));
  assert.throws(() => media.finish(id, metadata), /格式/); assert.equal(media.list().length, 0); assert.equal(media.cancel(id), true); assert.deepEqual(fs.readdirSync(path.join(dir, 'media')), []);
  assert.throws(() => media.append(id, 1, data), /顺序/);
});
test('failed index persistence retains an interrupted file instead of a false completed item', t => {
  const { store, media, dir } = fixture(t); const id = media.begin({ mime: 'video/mp4', audio: 'none' }); media.append(id, 0, data);
  store.write = () => { throw new Error('disk full'); }; assert.throws(() => media.finish(id, metadata), /disk full/); assert.equal(media.list().length, 0); assert.ok(fs.existsSync(path.join(dir, 'media', id + '.part')));
});

test('abandon releases capture for retry and failed deletion keeps the entry visible', t => {
  const { media, dir } = fixture(t), input = { mime: 'video/mp4', audio: 'none' };
  const interrupted = media.begin(input); media.append(interrupted, 0, data); media.abandon(interrupted);
  assert.equal(media.pending.size, 0); assert.ok(fs.existsSync(path.join(dir, 'media', interrupted + '.part')));
  const id = media.begin(input); media.append(id, 0, data); media.finish(id, metadata);
  const remove = fs.rmSync; fs.rmSync = () => { throw new Error('permission denied'); };
  try { assert.throws(() => media.delete([id]), /permission/); assert.equal(media.list().length, 1); }
  finally { fs.rmSync = remove; }
  media.delete([id]); assert.equal(media.list().length, 0);
});
