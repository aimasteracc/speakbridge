// Renderer-only fixtures through the real Electron IPC subscription. No audio,
// network, user history or ASR timing claims. Optional video is explicitly demo text.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.resolve(__dirname, '..'), version = require('../package.json').version;
const output = path.join(root, 'test-artifacts', `visual-${version}`);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'speakbridge-visual-'));
fs.mkdirSync(output, { recursive: true });
let app, page, overlay, screencast;
const frames = [];
const errors = [], checks = [];
let streamingMetrics;
const session = { id: 'visual-fixture', title: '文字修订效果演示', startedAt: Date.now(), durationMs: 0, audioSource: 'microphone', sourceLanguage: 'zh', targetLanguage: 'off', demo: true, segments: [], notes: '', starred: false, status: 'recording' };
const row = (id, text, final = false) => ({ id, text, final, translation: '', startMs: Number(id.replace(/\D/g, '')) * 4000 || 0, endMs: 4000 });
async function publish() {
  await app.evaluate(({ BrowserWindow }, payload) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('bridge:event', { type: 'session', payload });
  }, { status: 'recording', session, error: '' });
}
async function text(value) {
  session.segments.at(-1).text = value; await publish();
  await page.waitForFunction(value => [...document.querySelectorAll('.original-text')].at(-1)?.textContent === value, value);
}
async function bottom(target = page, selector = '.transcript') {
  await target.waitForFunction(selector => { const el = document.querySelector(selector); return el && Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) < 2; }, selector);
}
async function check(name, fn) { await fn(); checks.push(name); console.log('PASS:', name); }
(async () => {
  try {
    const executablePath = process.env.SPEAKBRIDGE_TEST_EXECUTABLE;
    const env = { ...process.env, SPEAKBRIDGE_DATA_DIR: dir }; delete env.ELECTRON_RUN_AS_NODE; delete env.SPEAKBRIDGE_DEV_URL;
    app = await electron.launch({ ...(executablePath ? { executablePath, args: ['--user-data-dir=' + dir] } : { args: [root] }), env });
    assert.equal(fs.realpathSync(await app.evaluate(({ app }) => app.getPath('userData'))), fs.realpathSync(dir));
    page = await app.firstWindow(); page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('heading', { name: '实时翻译', exact: true }).waitFor();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900));
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    if (process.env.RECORD_VISUAL) {
      screencast = await page.context().newCDPSession(page);
      screencast.on('Page.screencastFrame', event => {
        const file = path.join(dir, `frame-${frames.length}.jpg`);
        fs.writeFileSync(file, Buffer.from(event.data, 'base64'));
        frames.push({ file, time: event.metadata.timestamp });
        void screencast.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
      });
      await screencast.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1280, maxHeight: 900, everyNthFrame: 1 });
    }
    await check('incremental revisions preserve exact text and stable prefix', async () => {
      session.segments = [row('row0', '今天')]; await publish();
      for (const value of ['今天我们来讨论', '今天我们来讨论语音识别', '今天我们来讨论语音识别的速度。']) { await page.waitForTimeout(650); await text(value); }
      const before = await page.locator('.original-text').boundingBox();
      await page.waitForTimeout(500); await text('今天我们来讨论语音识别的准确率。');
      assert.ok((await page.locator('.original-text .stream-text > span').first().textContent()).startsWith('今天我们来讨论语音识别的'));
      const after = await page.locator('.original-text').boundingBox();
      assert.equal(after.x, before.x); assert.equal(after.y, before.y); assert.equal(after.height, before.height);
      await page.waitForTimeout(900);
      const height = (await page.locator('.transcript-row').boundingBox()).height;
      session.segments[0].final = true; await publish();
      await page.locator('.transcript-row:not(.partial)').waitFor();
      assert.equal((await page.locator('.transcript-row').boundingBox()).height, height);
      session.segments.push(row('row1', '新增文字')); await publish();
      for (const value of ['新增文字会自然出现，', '新增文字会自然出现，修改只发生在变化的位置。']) { await page.waitForTimeout(700); await text(value); }
      await page.waitForTimeout(750);
      await page.screenshot({ path: path.join(output, 'live-revision.png') });
    });
    if (screencast) await screencast.send('Page.stopScreencast');
    await check('one ASR batch becomes multiple visible steps; revisions supersede unfinished output', async () => {
      session.segments = [row('stream0', '流')]; await publish();
      await page.locator('.original-text').filter({ hasText: /^流$/ }).waitFor();
      await page.evaluate(() => {
        window.__flowSamples = [];
        const element = document.querySelector('.original-text');
        window.__flowObserver = new MutationObserver(() => window.__flowSamples.push({ text: element.textContent, at: performance.now() }));
        window.__flowObserver.observe(element, { childList: true, characterData: true, subtree: true });
      });
      const target = '流式文字沿着当前句子自然接续，每一版结果都及时显示。';
      const started = await page.evaluate(() => performance.now());
      await text(target);
      const samples = await page.evaluate(() => { window.__flowObserver.disconnect(); return window.__flowSamples; });
      const visible = [...new Set(samples.map(s => s.text))];
      assert.ok(visible.length >= 5, 'A single received batch must produce intermediate visible strings');
      assert.ok(visible.slice(0, -1).every(value => target.startsWith(value)));
      assert.ok(samples.at(-1).at - started < 650, 'Reveal must finish within its bounded budget');
      streamingMetrics = { visibleSteps: visible.length, completeWithinMs: Math.round(samples.at(-1).at - started) };
      // Publish faster than display can finish. A correction must cancel old work.
      for (const value of ['流式文字继续接续更多新内容。', '流式文字继续接续更多新内容，尚未确认。', '修订后的正确结果。']) {
        session.segments[0].text = value; await publish(); await page.waitForTimeout(15);
      }
      await page.waitForFunction(() => document.querySelector('.original-text').textContent === '修订后的正确结果。');
      await page.waitForTimeout(400);
      assert.equal(await page.locator('.original-text').textContent(), '修订后的正确结果。');
      session.segments[0].text += '这是必须立即显示的最终内容。'.repeat(10); await publish();
      session.segments[0].final = true; await publish();
      await page.waitForFunction(value => document.querySelector('.original-text').textContent === value, session.segments[0].text, { timeout: 250 });
    });
    await check('legacy punctuation-only rows stay hidden without suppressing real sentences', async () => {
      session.segments = [row('noise0', '。', true), row('noise1', '。。。', true), row('real2', '预算 3.14 万元。', true)]; await publish();
      await page.getByText('预算 3.14 万元。', { exact: true }).waitFor();
      assert.equal(await page.locator('.transcript-row').count(), 1);
    });
    await check('rapid corrections, shortening and Unicode have no display backlog', async () => {
      for (const value of ['快速修订一', '快速修订二', '快速修订三', '短句', '👩🏽‍💻 Café · 日本語と中文。']) await text(value);
      assert.equal(await page.locator('.original-text').last().textContent(), '👩🏽‍💻 Café · 日本語と中文。');
      assert.ok(await page.locator('.original-text').last().locator('.stream-chunk').count() <= 24);
    });
    await check('translation arrival and finalization keep row geometry stable', async () => {
      session.targetLanguage = 'en'; session.segments = [row('translation0', '保留原文的位置。')]; await publish();
      await page.locator('.translation-slot').waitFor();
      const before = await page.locator('.transcript-row').boundingBox();
      session.segments[0].final = true; await publish(); await page.getByText('正在翻译…').waitFor();
      assert.equal((await page.locator('.transcript-row').boundingBox()).height, before.height);
      session.segments[0].translation = 'Keep the original text in place.'; await publish();
      await page.getByText('Keep the original text in place.', { exact: true }).waitFor();
      const after = await page.locator('.transcript-row').boundingBox();
      assert.ok(Math.abs(after.height - before.height) < 1); assert.equal(after.y, before.y);
    });
    await check('follow latest, pause for reading, retain anchor and resume', async () => {
      session.segments = Array.from({ length: 40 }, (_, i) => row('long' + i, `第 ${i + 1} 段：保持阅读位置，连续输出时平稳跟随最新文字。`, true)); await publish();
      await bottom();
      session.segments.push(row('long40', '新的内容仍在继续。')); await publish(); await bottom();
      const viewport = page.locator('.transcript'); await viewport.hover(); await page.mouse.wheel(0, -650);
      await page.getByRole('button', { name: '↓ 回到最新', exact: true }).waitFor();
      await page.waitForTimeout(300);
      const anchor = await viewport.evaluate(el => {
        const top = el.getBoundingClientRect().top;
        const row = [...el.querySelectorAll('.transcript-row')].find(row => row.getBoundingClientRect().top >= top);
        return { id: row.dataset.segmentId, y: row.getBoundingClientRect().top, scrollTop: el.scrollTop };
      });
      await text('新的内容仍在继续。'.repeat(20));
      assert.ok(Math.abs(await viewport.evaluate(el => el.scrollTop) - anchor.scrollTop) < 2);
      session.segments[0].translation = 'An earlier translation arrives late. '.repeat(25); await publish();
      await page.getByText(session.segments[0].translation, { exact: true }).waitFor({ state: 'attached' });
      await page.waitForTimeout(200);
      assert.ok(Math.abs((await page.locator(`[data-segment-id="${anchor.id}"]`).boundingBox()).y - anchor.y) < 2, 'Older translation must not displace the passage being read');
      await page.getByRole('button', { name: '↓ 回到最新', exact: true }).click(); await bottom();
      assert.equal(await page.getByRole('button', { name: '↓ 回到最新', exact: true }).count(), 0);
      await viewport.click({ position: { x: 120, y: 80 } });
      await page.getByRole('button', { name: '↓ 回到最新', exact: true }).waitFor();
      await page.getByRole('button', { name: '↓ 回到最新', exact: true }).click(); await bottom();
    });
    await check('compact live window keeps stop control and reading viewport visible', async () => {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 650));
      await bottom();
      const viewport = await page.locator('.transcript').boundingBox(); assert.ok(viewport.height > 280, `viewport height ${viewport.height}`);
      const stop = await page.getByRole('button', { name: /结束演示/ }).boundingBox(); assert.ok(stop.y > 0 && stop.y + stop.height < 650);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: path.join(output, 'compact-follow.png') });
    });
    await check('overlay retains origin and font size when translation arrives', async () => {
      const windowReady = app.waitForEvent('window');
      await page.evaluate(() => window.speakbridge.showOverlay(true));
      overlay = await windowReady;
      await overlay.getByLabel('关闭字幕').waitFor();
      overlay.on('pageerror', error => errors.push(error.message));
      session.segments = [row('overlay0', '字幕保持稳定，文字自然接续。')]; await publish();
      await overlay.getByText(session.segments[0].text, { exact: true }).waitFor();
      const before = await overlay.locator('.subtitle-original').evaluate(el => ({ font: getComputedStyle(el).fontSize, x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y }));
      session.segments[0].translation = 'Stable subtitles, with a natural flow.'; await publish();
      await overlay.getByText(session.segments[0].translation, { exact: true }).waitFor();
      const after = await overlay.locator('.subtitle-original').evaluate(el => ({ font: getComputedStyle(el).fontSize, x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y }));
      assert.deepEqual(after, before);
      await overlay.screenshot({ path: path.join(output, 'overlay.png') });
      session.segments[0].text += '较长的句子也能继续跟随，不丢失正在显示的末尾。'.repeat(15); await publish(); await bottom(overlay, '.subtitle-copy');
      session.segments[0].text = '下一句简短字幕。'; await publish();
      await overlay.getByText('下一句简短字幕。', { exact: true }).waitFor(); await bottom(overlay, '.subtitle-copy');
      assert.equal(await overlay.locator('.subtitle-copy').getAttribute('data-follow'), 'active');
    });
    await check('reduced motion disables word animation and settles scrolling immediately', async () => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await text('系统要求减少动态效果时，直接显示完整结果。');
      assert.ok((await page.locator('.original-text .stream-chunk').evaluateAll(nodes => nodes.map(el => getComputedStyle(el).animationName))).every(name => name === 'none'));
      await bottom();
    });
    await check('long history remains scrollable at minimum window size with plain text', async () => {
      session.segments = Array.from({ length: 30 }, (_, i) => row('saved' + i, `历史第 ${i + 1} 段：已确认的内容完整保存。`, true));
      session.endedAt = Date.now(); session.status = 'completed';
      await app.evaluate(({ BrowserWindow }, session) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('bridge:event', { type: 'history', payload: [session] });
          win.webContents.send('bridge:event', { type: 'session', payload: { status: 'idle', session, error: '' } });
        }
      }, session);
      await page.getByRole('button', { name: /文字修订效果演示/ }).click();
      const viewport = page.getByRole('dialog').locator('.transcript');
      await viewport.evaluate(el => { el.scrollTop = el.scrollHeight; });
      const bounds = await viewport.boundingBox(), last = await page.getByRole('dialog').locator('.transcript-row').last().boundingBox();
      assert.ok(last.y >= bounds.y && last.y + last.height <= bounds.y + bounds.height);
      assert.equal(await page.getByRole('dialog').locator('.stream-chunk').count(), 0);
      assert.equal(await page.getByRole('dialog').locator('.original-text').last().textContent(), session.segments.at(-1).text);
      await page.getByLabel('关闭详情').click();
    });
    assert.deepEqual(errors, []);
    const bootstrap = await page.evaluate(() => window.speakbridge.bootstrap());
    assert.equal(bootstrap.sessions.length, 0); assert.equal(bootstrap.state.status, 'idle');
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: true, version, packaged: !!executablePath, checks, streamingMetrics, errors, syntheticTextOnly: true, userDataIsolated: true }, null, 2));
  } catch (error) {
    console.error(error);
    if (page && !page.isClosed()) console.error(await page.locator('.transcript').evaluateAll(nodes => nodes.map(el => ({ top: el.scrollTop, height: el.clientHeight, total: el.scrollHeight, follow: el.dataset.follow }))));
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    if (app) await app.close();
    if (frames.length > 1) {
      const list = path.join(dir, 'frames.txt');
      fs.writeFileSync(list, frames.map((frame, i) => `file '${frame.file}'\nduration ${Math.max(.01, (frames[i + 1]?.time ?? frame.time + .5) - frame.time)}\n`).join('') + `file '${frames.at(-1).file}'\n`);
      require('node:child_process').execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-vf', 'fps=30,format=yuv420p', '-movflags', '+faststart', path.join(output, 'visual-demo.mp4')], { stdio: 'pipe' });
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
