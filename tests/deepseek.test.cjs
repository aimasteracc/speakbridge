const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { prepareDsh, detectDsh, dshCommand } = require('../electron/deepseek.cjs');
const { resolveEngines } = require('../electron/providers.cjs');
const { DEFAULT_SETTINGS, validateSettings } = require('../electron/core.cjs');

test('DeepSeek Harness explicit routing, validation and launcher discovery', () => {
  const s = validateSettings({ ...DEFAULT_SETTINGS, textProvider: 'deepseek' });
  assert.equal(resolveEngines(s, 'key', { deepseek: '/dsh' }).text, 'deepseek');
  assert.equal(resolveEngines(DEFAULT_SETTINGS, '', { deepseek: '/dsh' }).text, 'deepseek');
  assert.throws(() => resolveEngines(s, '', {}), /DeepSeek Harness/);
  assert.throws(() => validateSettings({ deepseekHome: 'relative/path' }), /绝对路径/);
  assert.equal(detectDsh('', () => '/known/dsh'), '/known/dsh');
  assert.equal(detectDsh('/missing/dsh.js', () => ''), '');
  assert.equal(dshCommand(__filename, () => process.execPath).prefix[0], __filename);
});
test('DSH isolated headless patch keeps long transcripts out of command arguments and denies tools', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-dsh-unit-'));
  try {
    const input = JSON.stringify({ transcript: 'quoted " $() ' + '测试'.repeat(20000) });
    const result = await prepareDsh(cwd, 'Translate only', input, path.join(cwd, 'existing-home'));
    assert.equal(result.args[1], 'headless'); assert.equal(result.args[4], 'SpeakBridge text task');
    assert.equal(result.args.some(value => value.includes('quoted')), false);
    assert.equal(result.env.DSH_HOME, path.join(cwd, 'dsh-home'));
    const patch = JSON.parse(fs.readFileSync(result.args[3], 'utf8'));
    assert.ok(patch.find(row => row.id === 'headless-runner').config.task.endsWith(input));
    assert.equal(patch.find(row => row.id === 'credentials').config.path, path.join(cwd, 'existing-home', '.credentials.yaml'));
    let guard, assemble, service;
    const plugin = await import(pathToFileURL(path.join(cwd, 'text-only.mjs')).href);
    plugin.apply({ tools: { guard: fn => { guard = fn; return () => {}; } }, effect: fn => fn(), on: (_name, fn) => { assemble = fn; }, provide: (name, value) => { service = [name, value]; } });
    assert.match(guard({ name: 'shell' }), /disabled/); assert.deepEqual(service, ['speakbridgeTextOnly', true]);
    const transformed = await assemble({}, {}, async () => ({ tools: [{ name: 'shell' }], contexts: ['private file'], sections: ['coding instructions'] }));
    assert.deepEqual(transformed.tools, []); assert.deepEqual(transformed.contexts, []);
    assert.equal(transformed.sections[0].name, 'speakbridge');
    assert.throws(() => plugin.apply({ tools: {} }), /Unsupported/);
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});
