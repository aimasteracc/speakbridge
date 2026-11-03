// UI-only fixtures: no microphone, credentials, native input or real clipboard.
const { chromium } = require('playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { DEFAULT_SETTINGS } = require('../electron/core.cjs');
const { dictationPreferences } = require('../electron/dictation.cjs');
const version = require('../package.json').version;
const output = path.resolve(__dirname, '../test-artifacts/cleanup-' + version);
(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, clearScreen: false }); await server.listen();
  let browser; const errors = [], checks = [];
  const boot = {
    settings: { ...DEFAULT_SETTINGS, textProvider: 'api', hasKey: true, hasSonioxKey: false, canEncrypt: true, ollamaModel: 'qwen3.5:2b', baseUrl: 'https://api.example.com/v1', translationModel: 'fixture-model' },
    sessions: [], state: { status: 'idle', session: null, error: '' }, platform: 'darwin', appVersion: version,
    dictation: { preferences: dictationPreferences({ holdKey: 'off' }), holdAvailable: false, handsFreeAvailable: true, inputAvailable: true, microphonePermission: 'granted', modelInstalled: true, modelReady: true },
    capabilities: { localInstalled: true, localReady: true, localModels: { sensevoice: true } },
  };
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addInitScript(({ boot }) => {
      const listeners = [];
      window.__emit = (type, payload) => {
        if (type === 'session') boot.state = payload;
        if (type === 'dictation-feedback') boot.dictationFeedback = payload;
        for (const fn of listeners) fn({ type, payload });
      };
      window.speakbridge = {
        bootstrap: async () => structuredClone(boot), onEvent: fn => { listeners.push(fn); return () => {}; },
        dictationStatus: async () => structuredClone(boot.dictation),
        detectEngines: async () => structuredClone(boot.capabilities),
        saveDictationPreferences: async preferences => {
          if (window.__failSave) throw Error('保存失败');
          boot.dictation.preferences = preferences; window.__emit('dictation-readiness', structuredClone(boot.dictation)); return structuredClone(boot.dictation);
        },
        copyDictation: async kind => { window.__copied = kind || 'result'; },
        cancelDictation: async () => { window.__cancelled = true; },
      };
    }, { boot });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.resolvedUrls.local[0]); await page.getByRole('button', { name: '语音输入', exact: true }).click();
    const choice = page.getByLabel('听写输出', { exact: true });
    assert.equal(await choice.inputValue(), 'off');
    await choice.selectOption('api');
    await page.locator('#dictation-cleanup-description').filter({ hasText: 'api.example.com' }).waitFor();
    assert.match(await page.locator('#dictation-cleanup-description').innerText(), /按服务用量收费/);
    checks.push('direct mode is default; API selection exposes endpoint, model and billing');
    await choice.selectOption('ollama');
    assert.match(await page.locator('#dictation-cleanup-description').innerText(), /本机 Ollama 的 qwen3.5:2b/);
    await page.getByRole('button', { name: '配置整理引擎', exact: true }).click();
    await page.getByLabel('已下载的 Ollama 模型', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('翻译与纪要引擎').inputValue(), 'api');
    checks.push('local cleanup configuration is accessible while meeting engine stays API');
    await page.getByLabel('已下载的 Ollama 模型', { exact: true }).fill('unsaved-draft-model');
    await page.getByRole('button', { name: '语音输入', exact: true }).click();
    assert.match(await page.locator('#dictation-cleanup-description').innerText(), /qwen3.5:2b/);
    assert.ok(!(await page.locator('#dictation-cleanup-description').innerText()).includes('unsaved-draft'));
    checks.push('data destination uses saved settings, not unsaved drafts');
    await page.evaluate(() => { window.__failSave = true; });
    await choice.selectOption('codex');
    await page.locator('.dictation-cleanup').getByRole('alert').filter({ hasText: '保存失败' }).waitFor();
    assert.equal(await choice.inputValue(), 'ollama');
    await page.evaluate(() => { window.__failSave = false; });
    await choice.selectOption('ollama');
    checks.push('failed setting save preserves selected provider');
    const resultSession = { id: 'fixture', mode: 'dictation', segments: [{ text: '嗯，我们四点开会。', final: true }], dictation: { text: '我们四点开会。', rawText: '嗯，我们四点开会。', status: 'inserted', targetName: '测试编辑器', message: '已输入到原输入框。', cleanup: { status: 'applied', provider: 'ollama', elapsedMs: 500 } } };
    await page.evaluate(session => window.__emit('session', { status: 'idle', session, error: '' }), resultSession);
    await page.getByText('已整理 · 查看识别原文', { exact: true }).click();
    await page.getByRole('button', { name: '复制识别原文', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__copied), 'original');
    await page.getByRole('button', { name: '复制文字', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__copied), 'result');
    checks.push('original and cleaned result remain separately copyable');
    fs.mkdirSync(output, { recursive: true });
    await page.locator('.dictation-cleanup').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, 'light.png') });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 900, height: 750 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(output, 'dark-900.png') });
    const overflow = await page.locator('.dictation-cleanup').evaluate(el => el.scrollWidth > el.clientWidth);
    assert.equal(overflow, false);
    checks.push('cleanup controls fit minimum desktop width in dark mode');
    await page.evaluate(session => {
      window.__emit('session', { status: 'stopping', session, error: '' });
      window.__emit('dictation-feedback', { phase: 'polishing', message: '正在整理表达…' });
    }, resultSession);
    await page.getByRole('heading', { name: '正在整理表达…', exact: true }).waitFor();
    assert.ok(await choice.isDisabled());
    await page.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__cancelled), true);
    const overlay = await context.newPage(); overlay.on('pageerror', error => errors.push(error.message));
    await overlay.goto(server.resolvedUrls.local[0] + '#dictation');
    await overlay.evaluate(() => window.__emit('dictation-feedback', { phase: 'polishing', message: '正在整理表达，可按 Esc 取消…' }));
    await overlay.getByText('正在整理…', { exact: true }).waitFor();
    await overlay.getByRole('button', { name: '取消听写', exact: true }).click();
    assert.equal(await overlay.evaluate(() => window.__cancelled), true);
    checks.push('main window and HUD expose polishing state with cancellation');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: true, version, checks, pageErrors: errors }, null, 2));
    console.log(JSON.stringify({ passed: true, checks }));
  } finally { await browser?.close(); await server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
