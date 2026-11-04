const { _electron: electron } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const executablePath = process.env.SPEAKBRIDGE_TEST_EXECUTABLE;
const root = path.resolve(__dirname, '..'), out = path.join(root, executablePath ? 'test-artifacts/workspace-package' : 'test-artifacts/workspace'); fs.mkdirSync(out, { recursive: true });
const http = require('node:http'), { DEFAULT_SETTINGS } = require('../electron/core.cjs');
let questionRequest; const textServer = http.createServer(async (req, res) => { let body = ''; for await (const chunk of req) body += chunk; assert.equal(req.url, '/api/chat'); questionRequest = JSON.parse(body); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ message: { content: '## 检查步骤\n\n- 确认本地测试成功。' } })); });
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'speakbridge-workspace-'));
fs.writeFileSync(path.join(data, 'dictation-settings.json'), JSON.stringify({ holdKey: 'off', handsFreeShortcut: 'off' }));
fs.writeFileSync(path.join(data, 'shortcuts.json'), JSON.stringify({ hold: [], dictation: [], meeting: [], overlay: [], capture: [], clipboard: [] }));
const session = { id: 'fixture-meeting', title: 'Synthetic meeting', status: 'completed', endedAt: Date.now(), startedAt: Date.now(), durationMs: 10000, audioSource: 'microphone', sourceLanguage: 'ja', targetLanguage: 'off', demo: false, segments: [{ id: 's1', text: '次回は公開前に動作を確認します。', translation: '', final: true, startMs: 0, endMs: 5000 }], notes: '# 合成テスト会議\n\n|項目|内容|\n|---|---|\n|目的|中文与日本語の表格確認|\n\n## 決定事項\n\n- テストを実施する。' };
fs.writeFileSync(path.join(data, 'sessions.json'), JSON.stringify([session]));
let app, page; const errors = [];
async function step(name, fn) { console.log('RUN', name); await fn(); console.log('PASS', name); }
async function launch() {
 const env = { ...process.env, SPEAKBRIDGE_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE; delete env.SPEAKBRIDGE_DEV_URL;
 app = await electron.launch({ ...(executablePath ? { executablePath, args: ['--user-data-dir=' + data] } : { args: [root] }), env }); assert.equal(fs.realpathSync(await app.evaluate(({ app }) => app.getPath('userData'))), fs.realpathSync(data)); page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', e => errors.push(e.message)); await page.getByRole('heading', { name: '实时翻译', exact: true }).waitFor();
 await app.evaluate(({ desktopCapturer, nativeImage }) => { desktopCapturer.getSources = async ({ types }) => [{ id: types[0] === 'screen' ? 'screen:fixture:0' : 'window:fixture:0', name: 'Synthetic QA source', thumbnail: nativeImage.createEmpty() }]; });
 await page.evaluate(() => {
   navigator.mediaDevices.getDisplayMedia = async ({ audio }) => {
     const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 540; const context = canvas.getContext('2d'); let n = 0;
     const draw = () => { context.fillStyle = '#153d32'; context.fillRect(0, 0, 960, 540); context.fillStyle = '#fff'; context.font = '38px sans-serif'; context.fillText('SpeakBridge 合成测试 ' + n++, 50, 80); context.fillStyle = '#e2a657'; context.fillRect(n % 800, 180, 120, 180); };
     draw(); const timer = setInterval(draw, 33), stream = canvas.captureStream(30), stop = stream.getVideoTracks()[0].stop.bind(stream.getVideoTracks()[0]); stream.getVideoTracks()[0].stop = () => { clearInterval(timer); stop(); };
     if (audio) { const ac = new AudioContext(), osc = ac.createOscillator(), dest = ac.createMediaStreamDestination(), gain = ac.createGain(); gain.gain.value = .08; osc.connect(gain).connect(dest); osc.start(); await ac.resume(); const track = dest.stream.getAudioTracks()[0], end = track.stop.bind(track); track.stop = () => { osc.stop(); void ac.close(); end(); }; stream.addTrack(track); }
     return stream;
   };
 });
}
(async () => { try {
 await new Promise(resolve => textServer.listen(0, '127.0.0.1', resolve));
 fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ ...DEFAULT_SETTINGS, textProvider: 'ollama', ollamaUrl: `http://127.0.0.1:${textServer.address().port}`, ollamaModel: 'synthetic-fixture' }));
 await launch();
 await step('settings search and all shortcut controls', async () => {
   await page.getByRole('button', { name: '快捷键', exact: true }).click(); await page.getByRole('button', { name: '添加快捷键', exact: true }).last().waitFor(); assert.equal(await page.getByRole('button', { name: '添加快捷键', exact: true }).count(), 6); await page.screenshot({ path: path.join(out, 'shortcuts.png') });
   await page.getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('textbox', { name: '搜索设置' }).fill('自动纪要'); await page.screenshot({ path: path.join(out, 'settings-search.png') });
 });
 await step('source preview cancel does not save and region screenshot respects crop', async () => {
   await page.getByRole('button', { name: '录屏与截图', exact: true }).click(); await page.getByRole('button', { name: '开始录屏', exact: true }).click(); await page.getByRole('button', { name: '预览画面' }).click(); await page.locator('.capture-preview-video').waitFor(); await page.keyboard.press('Escape'); assert.equal((await page.evaluate(() => window.speakbridge.mediaList())).length, 0);
   await page.getByRole('button', { name: '开始录屏', exact: true }).click(); await page.getByRole('button', { name: '预览画面' }).click(); await page.getByLabel('只录制指定范围').check(); await page.getByLabel('宽度 %').fill('50'); await page.getByLabel('高度 %').fill('50'); await page.screenshot({ path: path.join(out, 'crop.png') }); await page.getByRole('button', { name: '保存截图' }).click(); await page.getByText('素材已保存', { exact: true }).waitFor();
   const [item] = await page.evaluate(() => window.speakbridge.mediaList()); assert.equal(item.width, 480); assert.equal(item.height, 270);
 });
 await step('MP4 encoding with synthetic audio, actual inline playback, file export', async () => {
   await page.getByRole('button', { name: '开始录屏', exact: true }).click(); await page.getByLabel('录制音频').selectOption('system'); await page.getByRole('button', { name: '预览画面' }).click(); await page.getByRole('button', { name: '开始录制', exact: true }).click(); await page.getByText('正在采集画面', { exact: true }).waitFor(); await page.waitForTimeout(1300); const toolbar = app.windows().find(window => window.url().endsWith('#toolbar')); assert.ok(toolbar); await toolbar.getByRole('button', { name: '暂停会议' }).click(); await page.getByText('画面录制已暂停', { exact: true }).waitFor(); await page.waitForTimeout(700); await toolbar.getByRole('button', { name: '继续会议' }).click(); await page.waitForTimeout(1300); await page.getByRole('button', { name: '停止并保存画面' }).click(); await page.locator('.media-card video').waitFor();
   const items = await page.evaluate(() => window.speakbridge.mediaList()), video = items.find(x => x.kind === 'video'); assert.equal(video.mime, 'video/mp4'); assert.ok(video.bytes > 1000); assert.ok(video.durationMs >= 2300);
   const playback = await page.locator('.media-card video').evaluate(async video => { await video.play(); await new Promise(resolve => setTimeout(resolve, 400)); video.pause(); return { time: video.currentTime, width: video.videoWidth, height: video.videoHeight, error: video.error?.message }; }); assert.ok(playback.time > 0); assert.equal(playback.width, 960); assert.equal(playback.error, undefined);
   fs.copyFileSync(path.join(data, 'media', video.id + '.mp4'), path.join(out, 'synthetic-capture.mp4')); await page.screenshot({ path: path.join(out, 'media.png') });
 });
 await step('local OCR reads synthetic screenshot and memory stays local', async () => {
   const items = await page.evaluate(() => window.speakbridge.mediaList()), screenshot = items.find(x => x.kind === 'image');
   const text = await page.evaluate(id => window.speakbridge.screenOCR(id, 'eng'), screenshot.id); assert.match(text, /SpeakBridge/i);
   await page.evaluate(() => window.speakbridge.screenMemory('Synthetic test background')); assert.equal((await page.evaluate(() => window.speakbridge.screenList())).memories.length, 1);
 });
 await step('screen question UI routes only reviewed text and optional memory', async () => {
   await page.getByRole('button', { name: '屏幕问答', exact: true }).click();
   await page.getByLabel('确认要用于提问的文字').fill('Synthetic screen content'); await page.getByLabel('你的问题').fill('如何检查？');
   await page.getByRole('button', { name: '提问', exact: true }).click(); await page.getByRole('heading', { name: '检查步骤', exact: true }).waitFor();
   let sent = JSON.parse(questionRequest.messages[1].content); assert.equal(sent.screenText, 'Synthetic screen content'); assert.equal(sent.rememberedFacts, ''); assert.equal(sent.imageId, undefined);
   await page.getByLabel('附带下面保存的记忆').check(); await page.getByRole('button', { name: '提问', exact: true }).click(); await page.waitForFunction(() => document.querySelectorAll('.question-history article').length === 2);
   sent = JSON.parse(questionRequest.messages[1].content); assert.equal(sent.rememberedFacts, 'Synthetic test background'); await page.screenshot({ path: path.join(out, 'screen-question.png') });
 });
 await step('manual scrolling produces a taller aligned local PNG', async () => {
   await page.evaluate(() => { window.__qaScroll = 0; navigator.mediaDevices.getDisplayMedia = async () => { const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 300; const context = canvas.getContext('2d'); const draw = () => { const image = context.createImageData(400, 300); for (let y = 0; y < 300; y++) for (let x = 0; x < 400; x++) { const i = (y * 400 + x) * 4, row = y + window.__qaScroll; image.data[i] = (row * 7 + x * 3) % 256; image.data[i + 1] = (row * 11 + x) % 256; image.data[i + 2] = (row * 3 + x * 5) % 256; image.data[i + 3] = 255; } context.putImageData(image, 0, 0); }; draw(); const timer = setInterval(draw, 100), stream = canvas.captureStream(10), track = stream.getVideoTracks()[0], stop = track.stop.bind(track); track.stop = () => { clearInterval(timer); stop(); }; return stream; }; });
   await page.getByRole('button', { name: '录屏与截图', exact: true }).click(); await page.getByRole('button', { name: '开始录屏', exact: true }).click(); await page.getByRole('button', { name: '预览画面' }).click(); await page.getByRole('button', { name: '滚动长截图', exact: true }).click();
   await page.getByText('正在采集画面', { exact: true }).waitFor(); await page.evaluate(() => { window.__qaScroll = 121; }); await page.waitForTimeout(1500); await page.getByRole('button', { name: '停止并保存画面', exact: true }).click();
   await page.waitForFunction(async () => (await window.speakbridge.mediaList()).some(x => x.title === '滚动长截图'));
   const item = (await page.evaluate(() => window.speakbridge.mediaList())).find(x => x.title === '滚动长截图'); assert.equal(item.width, 400); assert.equal(item.height, 421);
 });
 await step('Word/PDF exports and speaker edits', async () => {
   await page.getByRole('button', { name: '会话历史', exact: true }).click(); await page.locator('.history-open').filter({ hasText: 'Synthetic meeting' }).click(); await page.getByLabel('标注 / 修改发言人').check(); await page.getByLabel('发言人 00:00', { exact: true }).fill('田中'); await page.getByRole('button', { name: '会议纪要', exact: true }).last().click();
   await page.waitForTimeout(200); assert.equal((await page.evaluate(() => window.speakbridge.listSessions()))[0].segments[0].speaker, '田中');
   for (const format of ['docx', 'pdf']) { const file = path.join(out, 'meeting.' + format); await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, file); assert.equal(await page.evaluate(({ id, format }) => window.speakbridge.exportSession(id, format), { id: session.id, format }), true); assert.ok(fs.statSync(file).size > 1000); }
   assert.equal(fs.readFileSync(path.join(out, 'meeting.pdf')).subarray(0, 4).toString(), '%PDF');
 });
 await step('restart preserves media, deletion does not delete meeting', async () => {
   await app.close(); app = null; await launch(); const list = await page.evaluate(() => window.speakbridge.mediaList()); assert.equal(list.length, 3); await page.evaluate(ids => window.speakbridge.mediaDelete(ids), list.map(x => x.id)); assert.equal((await page.evaluate(() => window.speakbridge.mediaList())).length, 0); assert.equal((await page.evaluate(() => window.speakbridge.listSessions())).length, 1);
 });
 assert.deepEqual(errors, []); fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ passed: true, errors, dataDirectory: data }, null, 2)); console.log('WORKSPACE E2E PASSED');
 } catch(error) { if (page) { await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {}); console.error((await page.locator('body').innerText().catch(() => '')).slice(-4000)); } console.error(error); process.exitCode = 1; } finally { if (app) await app.close(); await new Promise(resolve => textServer.close(resolve)); } })();
