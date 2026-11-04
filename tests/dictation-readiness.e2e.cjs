const { chromium } = require('playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { DEFAULT_SETTINGS } = require('../electron/core.cjs');
const { dictationPreferences } = require('../electron/dictation.cjs');
const version = require('../package.json').version, output = path.resolve(__dirname, '../test-artifacts/readiness-' + version);
(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, clearScreen: false }); await server.listen();
  let browser; const errors = [], checks = [];
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const readiness = { preferences: dictationPreferences({}, 'darwin'), holdAvailable: false, handsFreeAvailable: true, inputAvailable: false, microphonePermission: 'denied', modelInstalled: true, modelReady: false, message: '辅助功能尚未授权' };
    const boot = { settings: { ...DEFAULT_SETTINGS, hasKey: false, hasSonioxKey: false, canEncrypt: true }, sessions: [], state: { status: 'idle', session: null, error: '' }, platform: 'darwin', osVersion: '25', appVersion: version, shortcutAvailable: true, dictationShortcutAvailable: true, dictation: readiness, dataDirectory: '/isolated-test', capabilities: { localInstalled: true, localReady: false, localModels: { sensevoice: true } } };
    await context.addInitScript(({ boot }) => {
      const listeners = [];
      window.__ready = patch => { Object.assign(boot.dictation, patch); for (const fn of listeners) fn({ type: 'dictation-readiness', payload: structuredClone(boot.dictation) }); };
      let shortcuts = { bindings: { hold: ['fn'], dictation: ['CommandOrControl+Shift+D'], meeting: [], overlay: [], capture: [], clipboard: [] }, errors: [], nativeAvailable: true };
      window.speakbridge = { shortcutsGet: async () => structuredClone(shortcuts), shortcutsSave: async bindings => { shortcuts = { ...shortcuts, bindings }; window.__ready({ holdBindings: bindings.hold, handsFreeBindings: bindings.dictation }); return structuredClone(shortcuts); }, bootstrap: async () => structuredClone(boot), onEvent: fn => { listeners.push(fn); return () => {}; }, dictationStatus: async () => structuredClone(boot.dictation), warmDictation: async () => structuredClone(boot.dictation), saveDictationPreferences: async preferences => { window.__ready({ preferences }); return structuredClone(boot.dictation); } };
      // No OS microphone access in this UI regression test.
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => ({ getTracks: () => [{ stop() {} }] }) });
    }, { boot });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.resolvedUrls.local[0]); await page.getByRole('button', { name: '语音输入', exact: true }).click();
    await page.getByRole('heading', { name: '先完成权限准备。' }).waitFor();
    assert.equal(await page.locator('.dictation-key').innerText(), '右 Option');
    assert.equal(await page.getByText('按住这个键，开始说话', { exact: true }).count(), 0);
    await page.getByText('快捷键未就绪', { exact: true }).waitFor();
    checks.push('default Mac shortcut is Right Option; denied permissions never claim selected mode ready');
    fs.mkdirSync(output, { recursive: true }); await page.screenshot({ path: path.join(output, 'permissions-required.png') });
    await page.evaluate(() => window.__ready({ microphonePermission: 'granted', inputAvailable: true, holdAvailable: false }));
    await page.getByRole('heading', { name: '当前听写方式尚未就绪。' }).waitFor();
    await page.getByRole('button', { name: '准备开始', exact: true }).click();
    await page.getByRole('button', { name: '准备开始', exact: true }).waitFor();
    assert.equal(await page.getByText('准备好了。回到你要输入文字的应用，使用快捷键即可。', { exact: true }).count(), 0);
    checks.push('available hands-free shortcut cannot masquerade as working hold mode, including after setup');
    await page.evaluate(() => window.__ready({ preferences: { holdKey: 'off', handsFreeShortcut: 'CommandOrControl+Shift+D' } }));
    await page.getByRole('heading', { name: '按一下开始，再按一下输入。' }).waitFor();
    checks.push('explicit hands-free mode is ready when its own shortcut and permissions are available');
    await page.evaluate(() => window.__ready({ preferences: { holdKey: 'fn', handsFreeShortcut: 'CommandOrControl+Shift+D' }, holdAvailable: true }));
    await page.getByRole('button', { name: '修改快捷键' }).click();
    await page.getByRole('button', { name: '删除快捷键 fn', exact: true }).click();
    await page.getByRole('button', { name: '添加快捷键', exact: true }).first().click();
    await page.getByRole('group', { name: '添加按住说话快捷键', exact: true }).getByRole('combobox').selectOption('rightalt');
    await page.getByRole('button', { name: '删除快捷键 rightalt', exact: true }).waitFor();
    checks.push('shortcut editor removes Fn and adds Right Option through the new multiple-binding settings');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: true, version, checks, pageErrors: errors }, null, 2)); console.log(JSON.stringify({ passed: true, checks }));
  } finally { await browser?.close(); await server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
