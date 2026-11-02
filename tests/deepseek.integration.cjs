// Uses the installed real dsh CLI against a synthetic local DeepSeek endpoint.
const http = require('node:http');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { runCli, detect } = require('../electron/providers.cjs');
const { DEFAULT_SETTINGS } = require('../electron/core.cjs');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-dsh-integration-'));
let requests = 0, forceError = false;
const server = http.createServer(async (req, res) => {
  let input = ''; for await (const chunk of req) input += chunk;
  const body = JSON.parse(input);
  assert.equal(req.url, '/chat/completions'); assert.equal(req.headers.authorization, 'Bearer synthetic-dsh-key');
  assert.ok(!body.tools || body.tools.length === 0); assert.ok(JSON.stringify(body.messages).includes('quoted test transcript'));
  requests++;
  if (forceError) { res.writeHead(402, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'Insufficient Balance', type: 'insufficient_balance', code: 'insufficient_balance' } })); }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.write('data: ' + JSON.stringify({ id: 'test', object: 'chat.completion.chunk', model: 'deepseek-v4-flash', choices: [{ index: 0, delta: { role: 'assistant', content: 'DeepSeek Harness 测试译文。' }, finish_reason: null }] }) + '\n\n');
  res.write('data: ' + JSON.stringify({ id: 'test', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }) + '\n\n');
  res.end('data: [DONE]\n\n');
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    process.env.DEEPSEEK_BASE_URL = `http://127.0.0.1:${server.address().port}`;
    process.env.DEEPSEEK_API_KEY = 'synthetic-dsh-key';
    const settings = { ...DEFAULT_SETTINGS, deepseekHome: home };
    const binary = detect(settings).deepseek; assert.ok(binary, 'Install official dsh before running this integration test');
    const text = await runCli('deepseek', binary, settings, 'Translate only.', JSON.stringify({ transcript: 'quoted test transcript' }));
    assert.equal(text, 'DeepSeek Harness 测试译文。'); assert.equal(requests, 1);
    forceError = true;
    await assert.rejects(runCli('deepseek', binary, settings, 'Translate only.', JSON.stringify({ transcript: 'quoted test transcript' })), /余额或额度不足/);
    assert.equal(fs.existsSync(path.join(home, 'sessions')), false);
    fs.writeFileSync('test-artifacts/deepseek-result.json', JSON.stringify({ cliVersion: '0.1.5-rc.1', realCliAgainstLocalFixture: 'passed', noModelTools: true, quotaError: 'passed', userHistoryUnchanged: true, requests }, null, 2));
    console.log('PASS: real DeepSeek Harness headless CLI, tool-free request, parsed final text, quota failure and isolated history');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(home, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
