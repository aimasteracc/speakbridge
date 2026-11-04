const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { WebSocketServer } = require('ws');
const root = path.resolve(__dirname, '..');
const executablePath = process.env.SPEAKBRIDGE_TEST_EXECUTABLE;
const output = path.join(root, 'test-artifacts');
fs.mkdirSync(output, { recursive: true });
const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'speakbridge-e2e-'));
fs.writeFileSync(path.join(dataDirectory, 'dictation-settings.json'), JSON.stringify({ holdKey: 'off', handsFreeShortcut: 'off' }));
fs.writeFileSync(path.join(dataDirectory, 'shortcuts.json'), JSON.stringify({ hold: [], dictation: [], meeting: [], overlay: [], capture: [], clipboard: [] }));
let clipboardBackup;
let app, page, pcmBytes = 0, turn = 0, translateCalls = 0;
const failures = [];
const server = http.createServer(async (req, res) => {
  let data = ''; for await (const chunk of req) data += chunk;
  if (req.url !== '/v1/responses') { res.writeHead(404); return res.end(); }
  assert.equal(req.headers.authorization, 'Bearer synthetic-test-key');
  const body = JSON.parse(data); assert.equal(body.store, false);
  translateCalls++;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: (body.instructions.includes('纪要') || body.instructions.includes('議事録')) ? '讨论要点：跨平台实时翻译。\n已达成的决定：发布桌面版本。\n待办事项：验证系统权限。责任人未明确。' : 'Windows 和 Mac 都能使用实时翻译。' }] }] }));
});
const ws = new WebSocketServer({ server });
ws.on('connection', socket => socket.on('message', data => {
  const event = JSON.parse(data.toString());
  if (event.type === 'session.update') socket.send(JSON.stringify({ type: 'session.updated' }));
  if (event.type === 'input_audio_buffer.append') pcmBytes += Buffer.from(event.audio, 'base64').length;
  if (event.type === 'input_audio_buffer.commit') {
    const id = `turn-${++turn}`;
    socket.send(JSON.stringify({ type: 'input_audio_buffer.committed', item_id: id }));
    socket.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.delta', item_id: id, delta: 'Windows と Mac' }));
    setTimeout(() => { if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: id, transcript: 'Windows と Mac でリアルタイム翻訳が使えます。' })); }, 120);
  }
}));
async function launch() {
  const env = { ...process.env, SPEAKBRIDGE_DATA_DIR: dataDirectory }; delete env.ELECTRON_RUN_AS_NODE; delete env.SPEAKBRIDGE_DEV_URL;
  app = await electron.launch({ ...(executablePath ? { executablePath, args: ['--user-data-dir=' + dataDirectory] } : { args: [root] }), env, timeout: 30000 });
  assert.equal(fs.realpathSync(await app.evaluate(({ app }) => app.getPath('userData'))), fs.realpathSync(dataDirectory));
  // Keep the system clipboard untouched; these scenarios verify renderer/IPC
  // behavior, while native clipboard interoperability is a separate OS check.
  await app.evaluate(({ clipboard, ClipboardItem }) => { let items = []; clipboard.read = async () => items; clipboard.write = async value => { items = value; }; clipboard.writeText = async text => { items = [new ClipboardItem({ 'text/plain': text })]; }; clipboard.readText = async () => { for (const item of items) if (item.types.includes('text/plain')) return (await item.getType('text/plain')).text(); return ''; }; });
  if (!clipboardBackup) clipboardBackup = await app.evaluate(async ({ clipboard }) => {
    const result = [];
    for (const item of await clipboard.read()) {
      const parts = {};
      for (const type of item.types) { const value = await item.getType(type); parts[type] = value.arrayBuffer ? { bytes: Buffer.from(await value.arrayBuffer()).toString('base64') } : { bookmark: value }; }
      result.push(parts);
    }
    return result;
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => failures.push(error.message));
  await page.getByRole('heading', { name: '实时翻译', exact: true }).waitFor();
}
async function step(name, action) { console.log('RUN:', name); await action(); console.log('PASS:', name); }
async function waitIdle() { await page.getByRole('button', { name: /开始会话/ }).waitFor({ timeout: 35000 }); }
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await launch();
    await step('initial desktop layout and isolated renderer', async () => {
      assert.equal(await page.evaluate(() => typeof require), 'undefined');
      await page.screenshot({ path: path.join(output, '01-main.png') });
      await page.getByRole('button', { name: /开始会话/ }).click();
      await page.getByRole('heading', { name: '设置', exact: true }).waitFor();
      assert.equal(await page.evaluate(async () => (await window.speakbridge.bootstrap()).settings.hasKey), false);
      await page.getByRole('button', { name: '实时翻译', exact: true }).click();
    });
    await step('demo produces bilingual text and native always-on-top subtitle window', async () => {
      await page.getByRole('button', { name: /悬浮字幕 置顶/ }).click();
      await page.getByRole('button', { name: '先体验演示', exact: true }).click();
      await page.getByText('今天我们来讨论一下新应用的发布。', { exact: true }).waitFor();
      assert.equal((await app.windows()).length, 2);
      assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => w.isAlwaysOnTop())), true);
      const overlay = (await app.windows()).find(w => w !== page);
      await overlay.screenshot({ path: path.join(output, '02-subtitles.png') });
      await page.screenshot({ path: path.join(output, '03-live-demo.png') });
      await page.getByRole('button', { name: /结束演示/ }).click(); await waitIdle();
    });
    await step('search, rename, clipboard and SRT export', async () => {
      await page.getByLabel('搜索历史记录').fill('不存在的词条');
      await page.getByText('没有找到匹配的会话').waitFor();
      await page.getByLabel('搜索历史记录').fill('');
      await page.locator('.history-open').filter({ hasText: '跨语言产品会议 · 演示' }).click();
      await page.getByLabel('会话标题').fill('重命名后的双语会话');
      await page.getByRole('button', { name: '复制', exact: true }).click();
      await page.getByText('已复制会话文本').waitFor();
      const copied = await app.evaluate(({ clipboard }) => clipboard.readText()); assert.match(copied, /今日は/);
      const exportPath = path.join(output, 'export.srt');
      await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, exportPath);
      await page.getByLabel('导出会话').selectOption('srt');
      await page.getByText('已导出会话').waitFor(); assert.match(fs.readFileSync(exportPath, 'utf8'), /00:00:00,000 -->/);
      await page.screenshot({ path: path.join(output, '04-history.png') });
      await page.getByLabel('关闭详情').click();
      await page.getByLabel('收藏会话').click();
    });
    await step('persistent settings, encrypted key and connection test against local fixtures', async () => {
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await page.getByLabel(/^API Key/).fill('synthetic-test-key');
      await page.getByLabel('API 地址').fill(`http://127.0.0.1:${server.address().port}/v1`);
      await page.getByRole('button', { name: '保存并测试连接' }).click();
      await page.getByText('语音与翻译服务连接成功').waitFor({ timeout: 20000 });
      const config = await page.evaluate(() => window.speakbridge.bootstrap());
      assert.equal(config.settings.apiKey, undefined); assert.equal(config.settings.hasKey, true);
      assert.equal(fs.readFileSync(path.join(dataDirectory, 'credential.json'), 'utf8').includes('synthetic-test-key'), false);
      await page.getByRole('button', { name: '个人词典' }).click();
      await page.getByLabel('添加常用词').fill('SpeakBridge'); await page.getByRole('button', { name: '添加', exact: true }).click();
      await page.getByText('个人词典已更新').waitFor();
    });
    await step('synthetic microphone and system audio pass through AudioWorklet, IPC, websocket and translation', async () => {
      await page.getByRole('button', { name: '实时翻译', exact: true }).click();
      await page.getByLabel('音频来源').selectOption('both');
      await page.evaluate(() => {
        const makeStream = async () => {
          const context = new AudioContext(); const oscillator = context.createOscillator();
          const gain = context.createGain(); gain.gain.value = .15;
          const destination = context.createMediaStreamDestination();
          oscillator.connect(gain).connect(destination); oscillator.start(); await context.resume();
          const track = destination.stream.getAudioTracks()[0]; const stop = track.stop.bind(track);
          track.stop = () => { stop(); oscillator.stop(); void context.close(); };
          return destination.stream;
        };
        Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: makeStream });
        Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: makeStream });
      });
      await page.getByRole('button', { name: /开始会话/ }).click();
      await page.getByRole('button', { name: /结束会话/ }).waitFor();
      await page.waitForFunction(() => document.querySelector('.volume-meter span')?.getAttribute('style') !== 'width: 0%;');
      // Record the already running meeting mix with a synthetic moving screen.
      await app.evaluate(({ desktopCapturer, nativeImage }) => { desktopCapturer.getSources = async () => [{ id: 'screen:fixture:0', name: 'Synthetic meeting screen', thumbnail: nativeImage.createEmpty() }]; });
      await page.evaluate(() => { const screenFixture = async () => { const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360; const ctx = canvas.getContext('2d'); let n = 0; const timer = setInterval(() => { ctx.fillStyle = '#153d32'; ctx.fillRect(0, 0, 640, 360); ctx.fillStyle = '#fff'; ctx.fillRect((n++ * 5) % 600, 100, 40, 100); }, 33); const stream = canvas.captureStream(30), track = stream.getVideoTracks()[0], stop = track.stop.bind(track); track.stop = () => { clearInterval(timer); stop(); }; return stream; }; Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: screenFixture }); });
      await page.getByRole('button', { name: '画面录制', exact: true }).click(); await page.getByRole('button', { name: '预览画面', exact: true }).click(); await page.getByRole('button', { name: '开始录制', exact: true }).click(); await page.getByText('正在采集画面', { exact: true }).waitFor();
      await page.getByRole('button', { name: '暂停会议', exact: true }).click();
      await page.getByRole('button', { name: '继续会议', exact: true }).waitFor(); const pausedBytes = pcmBytes; await page.waitForTimeout(450); assert.equal(pcmBytes, pausedBytes);
      const toolbar = app.windows().find(w => w.url().endsWith('#toolbar')); assert.ok(toolbar); await toolbar.getByRole('button', { name: '继续会议', exact: true }).click();
      await page.getByRole('button', { name: '暂停会议', exact: true }).waitFor();
      // Deliberately stop before the 8 s automatic commit, exercising final PCM flush.
      await page.waitForTimeout(1100);
      await page.getByRole('button', { name: /结束会话/ }).click(); await waitIdle();
      assert.ok(pcmBytes > 24000); assert.ok(turn >= 1); assert.ok(translateCalls >= 2);
      const records = await page.evaluate(() => window.speakbridge.listSessions());
      const actual = records.find(row => !row.demo);
      const videos = await page.evaluate(id => window.speakbridge.mediaList(id), actual.id); assert.equal(videos.length, 1); assert.equal(videos[0].audio, 'meeting'); assert.equal(videos[0].mime, 'video/mp4'); assert.ok(videos[0].durationMs > 1000);
      assert.equal(actual.audioSource, 'both'); assert.ok(actual.segments[0].translation.includes('Windows'));
      await page.locator('.history-open').filter({ hasText: 'Windows と Mac で' }).click();
      await page.getByRole('dialog').getByRole('button', { name: '会议纪要', exact: true }).click();
      await page.getByRole('button', { name: '生成会议纪要' }).click();
      await page.getByText(/讨论要点：跨平台实时翻译。/).waitFor();
      await page.getByLabel('关闭详情').click();
    });
    await step('denied capture releases resources and never starts a cloud session', async () => {
      const count = turn;
      await page.evaluate(() => Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) }));
      await page.getByRole('button', { name: /开始会话/ }).click();
      await page.getByText(/录音权限未开启/).waitFor();
      const data = await page.evaluate(() => window.speakbridge.bootstrap());
      assert.equal(data.state.status, 'idle'); assert.equal(data.sessions.length, 2); assert.equal(turn, count);
    });
    await step('restart preserves history, vocabulary, notes and key', async () => {
      await app.close(); await launch();
      const data = await page.evaluate(() => window.speakbridge.bootstrap());
      assert.equal(data.sessions.length, 2); assert.equal(data.settings.hasKey, true); assert.deepEqual(data.settings.dictionary, ['SpeakBridge']);
      assert.ok(data.sessions.find(s => !s.demo).notes.includes('讨论要点'));
      assert.equal(data.sessions.find(s => s.demo).starred, true);
      assert.equal(data.sessions.find(s => s.demo).title, '重命名后的双语会话');
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await page.getByRole('button', { name: '移除密钥' }).click(); await page.getByText('API Key 已移除').waitFor();
    });
    await step('minimum window size and navigation', async () => {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !w.isAlwaysOnTop()).setSize(900, 650));
      for (const name of ['首页', '快捷键', '会议纪要', '会话历史', '实时翻译']) await page.getByRole('button', { name, exact: true }).click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const settingsButton = await page.getByRole('button', { name: '设置', exact: true }).boundingBox();
      assert.ok(settingsButton.y + settingsButton.height < 650);
      if (await page.getByLabel('关闭提示').count()) await page.getByLabel('关闭提示').click();
      await page.screenshot({ path: path.join(output, '05-compact.png') });
    });
    assert.deepEqual(failures, []);
    fs.writeFileSync(path.join(output, 'e2e-result.json'), JSON.stringify({ passed: true, scenarios: 8, pcmBytes, turns: turn, translateCalls, pageErrors: failures, time: new Date().toISOString() }, null, 2));
    console.log('ALL 8 ELECTRON SCENARIOS PASSED');
  } catch (error) {
    if (page && !page.isClosed()) { await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); console.error((await page.locator('body').innerText()).slice(-4500)); }
    throw error;
  } finally {
    if (app && clipboardBackup) await app.evaluate(async ({ clipboard, ClipboardItem }, backup) => {
      // Restore only if the clipboard still holds this test's own fixture.
      if (!(await clipboard.readText()).includes('重命名后的双语会话')) return;
      await clipboard.write(backup.map(parts => new ClipboardItem(Object.fromEntries(Object.entries(parts).map(([type, value]) => [type, value.bookmark || new Blob([Buffer.from(value.bytes, 'base64')], { type })])))));
    }, clipboardBackup).catch(() => {});
    if (app) await app.close().catch(() => {});
    for (const socket of ws.clients) socket.terminate();
    await new Promise(resolve => ws.close(resolve));
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
