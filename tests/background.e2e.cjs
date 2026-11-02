// Isolated demo session: verifies close-to-tray never hides an ongoing meeting.
const { _electron: electron } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), version = require('../package.json').version;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'speakbridge-background-'));
fs.writeFileSync(path.join(dir, 'dictation-settings.json'), JSON.stringify({ holdKey: 'off', handsFreeShortcut: 'off' }));
const env = { ...process.env, SPEAKBRIDGE_DATA_DIR: dir }; delete env.ELECTRON_RUN_AS_NODE; delete env.SPEAKBRIDGE_DEV_URL;
(async () => {
  let app;
  try {
    const executablePath = process.env.SPEAKBRIDGE_TEST_EXECUTABLE;
    app = await electron.launch({ ...(executablePath ? { executablePath, args: ['--user-data-dir=' + dir] } : { args: [root] }), env });
    assert.equal(fs.realpathSync(await app.evaluate(({ app }) => app.getPath('userData'))), fs.realpathSync(dir));
    const page = await app.firstWindow(); await page.getByRole('heading', { name: '实时翻译', exact: true }).waitFor();
    await page.evaluate(async () => { const { settings } = await window.speakbridge.bootstrap(); await window.speakbridge.start({ demo: true, settings }); });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !w.isAlwaysOnTop()).close());
    let boot;
    for (let i = 0; i < 100; i++) { boot = await page.evaluate(() => window.speakbridge.bootstrap()); if (boot.state.status === 'idle') break; await new Promise(resolve => setTimeout(resolve, 50)); }
    assert.equal(boot.state.status, 'idle'); assert.equal(boot.sessions.length, 1);
    assert.equal(boot.sessions[0].status, 'interrupted'); assert.ok(boot.sessions[0].endedAt);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !w.isAlwaysOnTop()).isVisible()), false);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !w.isAlwaysOnTop()).showInactive());
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !w.isAlwaysOnTop()).isVisible()), true);
    const result = { passed: true, version, packaged: !!executablePath, checks: ['closing an active meeting stops and saves before hiding; app remains reopenable'] };
    fs.writeFileSync(path.join(root, 'test-artifacts', 'background-' + version + '.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  } finally { if (app) await app.close().catch(() => {}); fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
