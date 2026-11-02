const { _electron: electron } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), version = require('../package.json').version;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'speakbridge-permission-'));
fs.writeFileSync(path.join(dir, 'dictation-settings.json'), JSON.stringify({ holdKey: 'off', handsFreeShortcut: 'off' }));
(async () => {
  let app; const executablePath = process.env.SPEAKBRIDGE_TEST_EXECUTABLE;
  try {
    const env = { ...process.env, SPEAKBRIDGE_DATA_DIR: dir }; delete env.ELECTRON_RUN_AS_NODE; delete env.SPEAKBRIDGE_DEV_URL;
    app = await electron.launch({ ...(executablePath ? { executablePath, args: ['--user-data-dir=' + dir] } : { args: [root] }), env });
    const page = await app.firstWindow(); await page.getByRole('heading', { name: '实时翻译', exact: true }).waitFor();
    assert.equal(fs.realpathSync(await app.evaluate(({ app }) => app.getPath('userData'))), fs.realpathSync(dir));
    await page.evaluate(() => window.speakbridge.dictationStatus(false));
    await app.evaluate(({ app, systemPreferences }) => {
      const req = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/electron/main.cjs'), { NativeInput } = req('./dictation.cjs');
      const originalDispose = NativeInput.prototype.dispose;
      globalThis.__permission = { statuses: 0, resets: 0, prompts: [], reject: false };
      systemPreferences.isTrustedAccessibilityClient = prompt => { globalThis.__permission.prompts.push(prompt); return true; };
      NativeInput.prototype.dispose = function () { globalThis.__permission.resets++; originalDispose.call(this); };
      NativeInput.prototype.request = async function (op) { const count = globalThis.__permission; if (op === 'status') { count.statuses++; return { ok: true, available: !count.reject && count.statuses > 1, message: 'fixture permission unavailable' }; } return { ok: true, available: false }; };
    });
    let result = await page.evaluate(() => window.speakbridge.dictationStatus(false));
    assert.equal(result.inputAvailable, true);
    assert.deepEqual(await app.evaluate(() => ({ statuses: globalThis.__permission.statuses, resets: globalThis.__permission.resets, prompts: globalThis.__permission.prompts })), { statuses: 2, resets: 1, prompts: [false] });
    await app.evaluate(() => Object.assign(globalThis.__permission, { statuses: 0, resets: 0, prompts: [], reject: true }));
    result = await page.evaluate(() => window.speakbridge.dictationStatus(true));
    assert.equal(result.inputAvailable, false); assert.match(result.message, /旧 SpeakBridge/);
    assert.deepEqual(await app.evaluate(() => globalThis.__permission.prompts), [true]);
    assert.equal(await app.evaluate(() => globalThis.__permission.resets), 1, 'recovery retries only once');
    await page.evaluate(async () => { const boot = await window.speakbridge.bootstrap(); await window.speakbridge.start({ demo: true, settings: boot.settings }); });
    await app.evaluate(() => { globalThis.__permission.prompts = []; });
    await page.evaluate(() => window.speakbridge.dictationStatus(true));
    assert.deepEqual(await app.evaluate(() => globalThis.__permission.prompts), [], 'active recording must not be reset by permission check');
    await page.evaluate(() => window.speakbridge.stop());
    const report = { passed: true, version, packaged: !!executablePath, checks: ['stale helper restarts once after parent permission is granted', 'user-requested permission prompt belongs to containing application', 'persistent denial explains old-version authorization', 'active recording skips permission recovery'], realPermissionsChanged: false };
    fs.writeFileSync(path.join(root, 'test-artifacts/permission-' + version + '.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  } finally { if (app) await app.close().catch(() => {}); fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
