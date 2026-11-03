// Packaged IPC/persistence smoke test with a separate, empty userData directory.
// Does not record, call model services, paste or alter the user's configuration.
const { _electron: electron } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const { DEFAULT_SETTINGS } = require('../electron/core.cjs');
const root = path.resolve(__dirname, '..'), version = require('../package.json').version;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'speakbridge-cleanup-package-'));
const executablePath = path.join(root, 'release', version, process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'SpeakBridge.app/Contents/MacOS/SpeakBridge');
let app;
async function launch() {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.SPEAKBRIDGE_DEV_URL;
  app = await electron.launch({ executablePath, args: ['--user-data-dir=' + directory], env });
  assert.equal(fs.realpathSync(await app.evaluate(({ app }) => app.getPath('userData'))), fs.realpathSync(directory));
  const page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.speakbridge));
  return page;
}
(async () => {
  fs.writeFileSync(path.join(directory, 'settings.json'), JSON.stringify({ ...DEFAULT_SETTINGS, speechProvider: 'local', textProvider: 'api', targetLanguage: 'off' }));
  fs.writeFileSync(path.join(directory, 'dictation-settings.json'), JSON.stringify({ holdKey: 'off', handsFreeShortcut: 'off' }));
  const before = fs.readFileSync(path.join(directory, 'settings.json'), 'utf8');
  let page = await launch();
  let boot = await page.evaluate(() => window.speakbridge.bootstrap());
  assert.equal(boot.appVersion, version); assert.equal(boot.dictation.preferences.cleanupProvider, 'off');
  assert.equal(boot.settings.hasKey, false);
  await page.getByRole('button', { name: '语音输入', exact: true }).click();
  await page.getByLabel('听写输出', { exact: true }).selectOption('codex');
  await page.getByText('听写输出方式已更新', { exact: true }).waitFor();
  boot = await page.evaluate(() => window.speakbridge.bootstrap());
  assert.equal(boot.dictation.preferences.cleanupProvider, 'codex');
  assert.equal(boot.settings.textProvider, 'api'); assert.equal(boot.state.status, 'idle');
  await app.close(); app = null;
  page = await launch();
  boot = await page.evaluate(() => window.speakbridge.bootstrap());
  assert.equal(boot.dictation.preferences.cleanupProvider, 'codex');
  assert.equal(boot.dictation.preferences.holdKey, 'off'); assert.equal(boot.dictation.preferences.handsFreeShortcut, 'off');
  assert.equal(fs.readFileSync(path.join(directory, 'settings.json'), 'utf8'), before);
  assert.equal(boot.sessions.length, 0);
  const result = { version, platform: process.platform, arch: process.arch, packagedLaunch: true, defaultOffMigration: true, preferencesPersistAcrossRestart: true, meetingSettingsUnchanged: true, realUserDataAccessed: false, microphoneUsed: false, externalRequestsMade: false };
  fs.writeFileSync(path.join(root, 'test-artifacts', `cleanup-package-${version}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  await app?.close(); fs.rmSync(directory, { recursive: true, force: true });
});
