const { test } = require('node:test');
const assert = require('node:assert/strict');
const { WebSocket, WebSocketServer } = require('ws');
const { SonioxTranscriber, ENDPOINT } = require('../electron/soniox.cjs');
const { DEFAULT_SETTINGS } = require('../electron/core.cjs');
const { resolveEngines } = require('../electron/providers.cjs');
const tick = () => new Promise(resolve => setTimeout(resolve, 20));
const token = (text, is_final, start_ms = 0, end_ms = 100) => ({ text, is_final, start_ms, end_ms });
async function serverTest(fn, handler) {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' }); await new Promise(resolve => server.once('listening', resolve));
  const updates = [], warnings = [], errors = [], translations = [];
  server.on('connection', handler);
  const client = new SonioxTranscriber({ settings: { ...DEFAULT_SETTINGS, sourceLanguage: 'zh', dictionary: ['声桥'] }, apiKey: 'soniox-test-key', drainMs: 200,
    socketFactory: (url, options) => { assert.equal(url, ENDPOINT); return new WebSocket(`ws://127.0.0.1:${server.address().port}`, options); },
    onSegment: row => updates.push(row), onWarning: error => warnings.push(error), onFatal: error => errors.push(error), translateText: async text => { translations.push(text); return '译文：' + text; } });
  try { await fn({ client, updates, errors, warnings, translations }); }
  finally { await client.stop(); for (const socket of server.clients) socket.terminate(); await new Promise(resolve => server.close(resolve)); }
}
test('Soniox revises only the provisional tail, preserves timestamps and drains delayed final tokens', async () => {
  let audioBytes = 0, configs = 0, eof = false;
  await serverTest(async ({ client, updates, errors, warnings, translations }) => {
    await client.connect(); client.push(Buffer.alloc(4800)); client.push(Buffer.alloc(4800, 3)); await tick();
    assert.ok(updates.some(row => row.text === '声巧'));
    assert.ok(updates.some(row => row.text === '声桥测试'));
    assert.ok(updates.some(row => row.text === '声桥测试好'));
    await client.stop();
    assert.equal(audioBytes, 9600); assert.equal(configs, 1); assert.ok(eof);
    const rows = [...new Map(updates.map(row => [row.id, row])).values()];
    assert.equal(rows[0].text, '声桥测试好了。'); assert.equal(rows[0].translation, '译文：声桥测试好了。');
    assert.equal(rows[0].startMs, 100); assert.equal(rows[0].endMs, 800);
    assert.equal(rows[1].text, '下一句。'); assert.ok(rows.every(row => row.final && !row.error));
    assert.deepEqual(translations, ['声桥测试好了。', '下一句。']); assert.deepEqual(errors, []); assert.deepEqual(warnings, []);
  }, (socket, request) => {
    assert.equal(request.headers.authorization, 'Bearer soniox-test-key');
    const send = tokens => socket.send(JSON.stringify({ tokens }));
    socket.on('message', (data, binary) => {
      if (binary) { audioBytes += data.length; return; }
      if (data.length) { const config = JSON.parse(data); configs++; assert.equal(config.api_key, undefined); assert.equal(config.sample_rate, 24000); assert.equal(config.enable_endpoint_detection, true); assert.deepEqual(config.context.terms, ['声桥']);
        send([token('声巧', false, 100, 300)]);
        send([token('声桥', true, 100, 300), token('测试', false, 300, 500)]);
        send([token('测试', true, 300, 500), token('好', false, 500, 600)]);
      } else { eof = true; setTimeout(() => {
        send([token('好了。', true, 500, 800), token('<end>', true), token('下一句', false, 1000, 1300)]);
        send([token('下一句。', true, 1000, 1400)]);
        socket.send(JSON.stringify({ tokens: [], finished: true })); socket.close();
      }, 35); }
    });
  });
});
test('Soniox removes a withdrawn provisional tail instead of appending repeated guesses', async () => {
  const updates = [];
  const client = new SonioxTranscriber({ settings: { ...DEFAULT_SETTINGS, targetLanguage: 'off' }, onSegment: x => updates.push(x), onWarning: assert.fail, onFatal: assert.fail });
  client.receive({ tokens: [token('甲', true, 100, 200), token('错误', false, 200, 500)] });
  client.receive({ tokens: [] }); assert.equal(updates.at(-1).text, '甲'); assert.equal(updates.at(-1).endMs, 200);
  client.receive({ tokens: [token('乙', false, 200, 300)] }); assert.equal(updates.at(-1).text, '甲乙');
  client.receive({ tokens: [token('丙', true, 200, 300), token('<end>', true)] });
  assert.equal(updates.at(-1).text, '甲丙'); assert.ok(updates.at(-1).final);
  await client.stop();
});
test('authentication failure after WebSocket opens fails connection test', async () => {
  await serverTest(async ({ client }) => { await assert.rejects(client.testConnection(), /401/); }, socket => socket.on('message', () => { socket.send(JSON.stringify({ error_code: 401, error_message: 'Invalid key' })); socket.close(); }));
});
test('unexpected disconnect retains provisional text with explicit incomplete error', async () => {
  await serverTest(async ({ client, updates, errors }) => {
    await client.connect(); client.push(Buffer.alloc(4800)); await tick(); await client.stop();
    assert.ok(errors.length); assert.equal(updates.at(-1).text, '未完成'); assert.ok(updates.at(-1).error); assert.ok(updates.at(-1).final);
  }, socket => socket.once('message', () => { socket.send(JSON.stringify({ tokens: [token('未完成', false)] })); socket.close(); }));
});
test('missing EOF acknowledgement times out, preserving partial text and reporting failure', async () => {
  await serverTest(async ({ client, updates, warnings }) => {
    await client.connect(); client.push(Buffer.alloc(4800)); await tick(); await client.stop();
    assert.match(warnings.join(' '), /定稿超时/); assert.equal(updates.at(-1).text, '保留'); assert.ok(updates.at(-1).error);
  }, socket => socket.once('message', () => socket.send(JSON.stringify({ tokens: [token('保留', false)] }))));
});
test('Soniox is explicitly selected, requires its own key and does not become the text engine', () => {
  assert.equal(resolveEngines(DEFAULT_SETTINGS, '', {}, false, true, 'soniox').speech, 'local');
  const s = { ...DEFAULT_SETTINGS, speechProvider: 'soniox', textProvider: 'ollama' };
  assert.throws(() => resolveEngines(s, 'openai', {}), /Soniox API Key/);
  assert.deepEqual(resolveEngines(s, '', {}, true, true, 'soniox'), { speech: 'soniox', text: 'ollama' });
  assert.equal(resolveEngines(s, '', {}, true, false).text, 'ollama');
});
