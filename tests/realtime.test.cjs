const { test } = require('node:test');
const assert = require('node:assert/strict');
const { WebSocketServer } = require('ws');
const { RealtimeTranscriber, translate } = require('../electron/realtime.cjs');
const { DEFAULT_SETTINGS } = require('../electron/core.cjs');
function pcm(value) { const b = Buffer.alloc(4800); for (let i = 0; i < b.length; i += 2) b.writeInt16LE(value, i); return b; }
test('actual websocket reconciles out-of-order transcripts, drains final turn and translates', async () => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise(resolve => server.on('listening', resolve));
  const rows = new Map(); const commits = []; let audioBytes = 0; let authorization;
  server.on('connection', (socket, request) => {
    authorization = request.headers.authorization;
    socket.on('message', data => {
      const event = JSON.parse(data.toString());
      if (event.type === 'session.update') socket.send(JSON.stringify({ type: 'session.updated' }));
      if (event.type === 'input_audio_buffer.append') audioBytes += Buffer.from(event.audio, 'base64').length;
      if (event.type === 'input_audio_buffer.commit') {
        const id = 'item-' + (commits.length + 1); commits.push(id);
        socket.send(JSON.stringify({ type: 'input_audio_buffer.committed', item_id: id }));
        setTimeout(() => { socket.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.delta', item_id: id, delta: 'partial' })); socket.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: id, transcript: id })); }, id === 'item-1' ? 160 : 10);
      }
    });
  });
  const client = new RealtimeTranscriber({ settings: { ...DEFAULT_SETTINGS, baseUrl: `http://127.0.0.1:${server.address().port}/v1` }, apiKey: 'test-key', onSegment: row => rows.set(row.id, row), onFatal: message => assert.fail(message), onWarning: message => assert.fail(message),
    fetchFn: async (_url, options) => { const body = JSON.parse(options.body); assert.equal(body.store, false); return { ok: true, json: async () => ({ output: [{ content: [{ type: 'output_text', text: '译文 ' + JSON.parse(body.input).transcript }] }] }) }; },
  });
  try {
    await client.connect();
    client.push(pcm(9000)); for (let i = 0; i < 7; i++) client.push(pcm(0)); client.push(pcm(8000));
    await client.stop();
    assert.equal(authorization, 'Bearer test-key'); assert.equal(commits.length, 2); assert.equal(audioBytes, 9 * 4800);
    assert.equal(rows.get('item-1').text, 'item-1'); assert.equal(rows.get('item-1').startMs, 0);
    assert.equal(rows.get('item-2').startMs, 800); assert.equal(rows.get('item-2').translation, '译文 item-2');
  } finally { for (const socket of server.clients) socket.terminate(); await new Promise(resolve => server.close(resolve)); }
});
test('transcription configuration error rejects connection promptly', async () => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' }); await new Promise(resolve => server.on('listening', resolve));
  server.on('connection', socket => socket.on('message', () => socket.send(JSON.stringify({ type: 'error', error: { message: 'model not found' } }))));
  const client = new RealtimeTranscriber({ settings: { ...DEFAULT_SETTINGS, baseUrl: `http://127.0.0.1:${server.address().port}` }, apiKey: 'test', onSegment: () => {}, onFatal: () => {}, onWarning: () => {} });
  try { await assert.rejects(client.connect(), /model not found/); await client.stop(); }
  finally { for (const socket of server.clients) socket.terminate(); await new Promise(resolve => server.close(resolve)); }
});
test('translation surfaces authentication error instead of inventing text', async () => {
  await assert.rejects(translate(DEFAULT_SETTINGS, 'bad', 'hello', undefined, async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'Invalid API key' } }) })), error => error.code === 'AUTH' && /401/.test(error.message));
});
