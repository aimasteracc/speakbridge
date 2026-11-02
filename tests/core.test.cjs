const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DEFAULT_SETTINGS, validateSettings, VoiceGate, exportSession, realtimeConfig } = require('../electron/core.cjs');
const { Store } = require('../electron/store.cjs');
function pcm(amplitude, ms = 100) { const buffer = Buffer.alloc(ms * 48); for (let i = 0; i < buffer.length; i += 2) buffer.writeInt16LE(amplitude, i); return buffer; }
test('VAD ignores silence, retains pre-roll, commits once after pause and flushes final speech', () => {
  const audio = [], commits = [];
  const gate = new VoiceGate({ onAudio: b => audio.push(b), onCommit: bounds => commits.push(bounds) });
  for (let i = 0; i < 20; i++) gate.push(pcm(0));
  assert.equal(audio.length, 0);
  gate.push(pcm(8000)); gate.push(pcm(7000));
  for (let i = 0; i < 7; i++) gate.push(pcm(0));
  assert.equal(commits.length, 1); assert.deepEqual(commits[0], { startMs: 1700, endMs: 2900 });
  gate.flush(); assert.equal(commits.length, 1);
  gate.push(pcm(6000)); gate.flush(); assert.equal(commits.length, 2);
});
test('VAD splits continuous speech every eight seconds without losing PCM frames', () => {
  let bytes = 0; const commits = [];
  const gate = new VoiceGate({ onAudio: b => bytes += b.length, onCommit: b => commits.push(b) });
  for (let i = 0; i < 95; i++) gate.push(pcm(5000)); gate.flush();
  assert.equal(bytes, 9500 * 48); assert.deepEqual(commits, [{ startMs: 0, endMs: 8000 }, { startMs: 8000, endMs: 9500 }]);
});
test('settings reject unsafe endpoints and malformed options', () => {
  for (const baseUrl of ['file:///etc', 'http://example.com/v1', 'https://user:pass@example.com', 'https://api.openai.com/v1?key=secret']) assert.throws(() => validateSettings({ baseUrl }));
  assert.equal(validateSettings({ baseUrl: 'http://127.0.0.1:1234/v1/' }).baseUrl, 'http://127.0.0.1:1234/v1');
  assert.throws(() => validateSettings({ dictionary: ['a\nb'] }));
  assert.throws(() => validateSettings({ silenceMs: NaN }));
  assert.deepEqual(validateSettings({ dictionary: [' a ', 'a'] }).dictionary, ['a']);
});
test('live transcription schema uses languages and manual client VAD', () => {
  const input = realtimeConfig({ ...DEFAULT_SETTINGS, sourceLanguage: 'ja', dictionary: ['声桥'] }).session.audio.input;
  assert.equal(input.turn_detection, null); assert.deepEqual(input.transcription.languages, ['ja']);
  assert.equal(input.transcription.language, undefined); assert.deepEqual(input.transcription.keywords, ['声桥']);
});
test('SRT exports ordered bilingual text with valid millisecond timestamps', () => {
  const data = { title: '会议', startedAt: 0, segments: [{ startMs: 65001, endMs: 67022, text: '第二句', translation: 'Second' }, { startMs: 0, endMs: 0, text: '第一句', translation: 'First' }] };
  const text = exportSession(data, 'srt');
  assert.match(text, /^1\n00:00:00,000 --> 00:00:00,500\n第一句\nFirst/);
  assert.match(text, /2\n00:01:05,001 --> 00:01:07,022/);
});
test('store preserves encrypted secrets, survives restart and recovers interrupted sessions', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'speakbridge-store-'));
  const encryption = { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s.split('').reverse().join('')), decryptString: b => b.toString().split('').reverse().join('') };
  try {
    const store = new Store(directory, encryption); store.saveSettings({ ...DEFAULT_SETTINGS, apiKey: 'private-test-secret' });
    assert.equal(store.publicSettings().apiKey, undefined);
    assert.equal(fs.readFileSync(path.join(directory, 'settings.json'), 'utf8').includes('secret'), false);
    store.saveSession({ id: 'one', startedAt: 1000, durationMs: 2000, segments: [], status: 'recording' });
    const restarted = new Store(directory, encryption);
    assert.equal(restarted.getKey(), 'private-test-secret'); assert.equal(restarted.find('one').status, 'interrupted');
    restarted.saveSettings({ ...DEFAULT_SETTINGS, apiKey: '' }); assert.equal(restarted.getKey(), '');
    fs.writeFileSync(path.join(directory, 'settings.json'), '{broken');
    assert.throws(() => new Store(directory, encryption), /无法读取/);
    assert.equal(fs.readFileSync(path.join(directory, 'settings.json'), 'utf8'), '{broken');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
module.exports = { pcm };
test('opening local settings never accesses keychain; API credentials decrypt only on demand', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'speakbridge-keychain-'));
  const encryption = { isEncryptionAvailable: () => { throw Error('unexpected keychain prompt'); }, decryptString: () => { throw Error('locked keychain'); } };
  try {
    const store = new Store(directory, encryption);
    assert.equal(store.publicSettings().canEncrypt, null);
    store.saveSettings({ ...DEFAULT_SETTINGS, speechProvider: 'local', targetLanguage: 'off' });
    store.write('credential.json', { encrypted: 'synthetic-ciphertext' });
    assert.equal(store.publicSettings().hasKey, true);
    assert.equal(JSON.stringify(store.publicSettings()).includes('synthetic-ciphertext'), false);
    assert.throws(() => store.getKey(), /无法解密/);
    assert.throws(() => store.saveSettings({ ...DEFAULT_SETTINGS, apiKey: 'test' }), /unexpected keychain prompt/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('Soniox credentials are independent, encrypted, removable and absent from public settings', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'speakbridge-soniox-store-'));
  const encryption = { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s.split('').reverse().join('')), decryptString: b => b.toString().split('').reverse().join('') };
  try {
    const store = new Store(directory, encryption);
    store.saveSettings({ ...DEFAULT_SETTINGS, apiKey: 'openai-private', sonioxApiKey: 'soniox-private' });
    const reboot = new Store(directory, encryption);
    assert.equal(reboot.getKey(), 'openai-private'); assert.equal(reboot.getKey('soniox'), 'soniox-private');
    assert.equal(reboot.publicSettings().hasSonioxKey, true); assert.equal(reboot.publicSettings().sonioxApiKey, undefined);
    assert.ok(!JSON.stringify(reboot.publicSettings()).includes('private'));
    for (const file of fs.readdirSync(directory)) assert.ok(!fs.readFileSync(path.join(directory, file), 'utf8').includes('private'));
    assert.throws(() => reboot.saveSettings({ ...DEFAULT_SETTINGS, apiKey: '', sonioxApiKey: '\ninvalid' }));
    assert.equal(reboot.getKey(), 'openai-private');
    reboot.saveSettings({ ...DEFAULT_SETTINGS, sonioxApiKey: '' });
    assert.equal(reboot.getKey('soniox'), ''); assert.equal(reboot.getKey(), 'openai-private');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
