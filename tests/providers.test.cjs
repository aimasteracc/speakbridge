const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { DEFAULT_SETTINGS, validateSettings } = require('../electron/core.cjs');
const { resolveEngines, runCli, TextRouter, cliArgs, cliCommand } = require('../electron/providers.cjs');
const { resamplePcm, LocalTranscriber } = require('../electron/local-speech.cjs');

test('auto routes by available credentials, explicit engine wins and missing CLI fails', () => {
  const s = DEFAULT_SETTINGS;
  assert.deepEqual(resolveEngines(s, 'key', { codex: '/codex' }), { speech: 'api', text: 'api' });
  assert.deepEqual(resolveEngines(s, '', { codex: '/codex' }), { speech: 'local', text: 'codex' });
  assert.deepEqual(resolveEngines(s, '', { claude: '/claude' }), { speech: 'local', text: 'claude' });
  assert.deepEqual(resolveEngines(s, '', {}), { speech: 'local', text: 'ollama' });
  assert.deepEqual(resolveEngines({ ...s, textProvider: 'ollama' }, 'key', {}), { speech: 'api', text: 'ollama' });
  assert.equal(resolveEngines({ ...s, targetLanguage: 'off' }, '', {}).text, 'off');
  assert.throws(() => resolveEngines({ ...s, textProvider: 'claude' }, '', {}), /没有找到/);
  assert.throws(() => resolveEngines({ ...s, speechProvider: 'api' }, '', {}), /需要密钥/);
  assert.throws(() => validateSettings({ ollamaUrl: 'https://external.example' }), /本机/);
  assert.throws(() => validateSettings({ harnessArgs: '[1]' }), /参数/);
});
test('CLI invocations disable tools and reject arbitrary Windows command scripts', () => {
  const codex = cliArgs('codex', DEFAULT_SETTINGS), claude = cliArgs('claude', DEFAULT_SETTINGS);
  assert.ok(codex.includes('read-only')); assert.ok(codex.includes('--ignore-user-config'));
  assert.ok(codex.includes('approval_policy="never"'));
  assert.equal(claude[claude.indexOf('--tools') + 1], ''); assert.ok(claude.includes('--safe-mode'));
  assert.throws(() => cliCommand('harness', 'untrusted.cmd', 'win32'), /exe/);
});
test('harness receives quoted stdin exactly; errors, abort and timeout are surfaced', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-provider-test-'));
  const script = path.join(directory, 'fixture.cjs');
  fs.writeFileSync(script, `let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const data=JSON.parse(input);if(data.instructions==='wait')setTimeout(()=>{},10000);else if(data.instructions==='error'){console.error('test failure');process.exit(2)}else console.log(JSON.stringify(data));});`);
  const s = { ...DEFAULT_SETTINGS, harnessArgs: JSON.stringify([script]) };
  try {
    const payload = 'quotes " & $(do-not-run) \n你好';
    const result = await runCli('harness', process.execPath, s, 'translate', payload);
    assert.deepEqual(JSON.parse(result), { instructions: 'translate', input: payload });
    await assert.rejects(runCli('harness', process.execPath, s, 'error', ''), /test failure/);
    await assert.rejects(runCli('harness', process.execPath, s, 'wait', '', undefined, 100), /未返回/);
    const controller = new AbortController(); setTimeout(() => controller.abort(), 100);
    await assert.rejects(runCli('harness', process.execPath, s, 'wait', '', controller.signal), /取消/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test('Ollama uses configured local chat endpoint and exposes missing-model errors', async () => {
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const part of req) raw += part;
    const data = JSON.parse(raw); assert.equal(data.stream, false); assert.equal(req.url, '/api/chat');
    if (data.model === 'missing') { res.writeHead(404); return res.end(JSON.stringify({ error: 'model missing' })); }
    assert.ok(data.messages[1].content.includes('quoted'));
    res.end(JSON.stringify({ message: { content: '本地译文' } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const settings = { ...DEFAULT_SETTINGS, ollamaUrl: `http://127.0.0.1:${server.address().port}` };
    assert.equal(await new TextRouter(settings, '', {}, 'ollama').translate('quoted'), '本地译文');
    await assert.rejects(new TextRouter({ ...settings, ollamaModel: 'missing' }, '', {}, 'ollama').translate('quoted'), /model missing/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('local speech resamples correctly, flushes tail and waits for translation before stop', async () => {
  const pcm = Buffer.alloc(6); [0, 3000, 6000].forEach((n, i) => pcm.writeInt16LE(n, i * 2));
  const resampled = resamplePcm(pcm); assert.equal(resampled.length, 2);
  assert.ok(Math.abs(resampled[0] - 1000 / 32768) < 1e-6); assert.ok(Math.abs(resampled[1] - 5000 / 32768) < 1e-6);
  const updates = [];
  const engine = new LocalTranscriber({ settings: DEFAULT_SETTINGS, manager: { prepare: async () => {}, transcribeAudio: async () => 'Hello' }, translateText: async () => { await new Promise(r => setTimeout(r, 10)); return '你好'; }, onSegment: row => updates.push(row), onWarning: () => {}, onFatal: assert.fail });
  // Gate timing is exercised separately with native VAD in asr-quality.cjs.
  // Here a delayed flush verifies shutdown waits for the final recognition.
  const gate = engine.gate; gate.connect = async () => {}; gate.push = () => {}; gate.dispose = () => {};
  gate.flush = async () => { await new Promise(r => setTimeout(r, 10)); gate.onSegment({ audio: new Float32Array(1600), startMs: 0, endMs: 100, overlap: false }); };
  await engine.connect(); const chunk = Buffer.alloc(4800); for (let i = 0; i < chunk.length; i += 2) chunk.writeInt16LE(5000, i);
  engine.push(chunk); await engine.stop();
  assert.ok(updates.every(row => !row.pending)); assert.equal(updates.at(-1).translation, '你好'); assert.equal(updates.at(-1).final, true);
});
