const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
let appearance;
test.before(async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/appearance.ts'), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  appearance = await import('data:text/javascript;base64,' + Buffer.from(output).toString('base64'));
});
function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
test('every palette has readable normal, secondary, selected and button text', () => {
  for (const [name, p] of Object.entries(appearance.palettes)) {
    for (const fg of ['text', 'muted']) for (const bg of ['canvas', 'surface', 'subtle']) assert.ok(contrast(p[fg], p[bg]) >= 4.5, `${name} ${fg}/${bg}: ${contrast(p[fg], p[bg])}`);
    for (const bg of ['surface', 'soft']) assert.ok(contrast(p.accent, p[bg]) >= 4.5, `${name} accent/${bg}`);
    assert.ok(contrast(p.onAccent, p.accent) >= 4.5, name + ' button');
    assert.ok(contrast(p.accent, p.surface) >= 3, name + ' focus indicator');
  }
});
test('missing, corrupt, inherited and inaccessible preferences safely fall back to the OS', () => {
  for (const value of [null, '', 'not-a-theme', 'constructor', '__proto__', '{}']) assert.equal(appearance.readAppearance({ getItem: () => value }), 'system');
  assert.equal(appearance.readAppearance({ getItem() { throw Error('Storage unavailable'); } }), 'system');
  assert.equal(appearance.resolveAppearance('system', true), 'night');
  assert.equal(appearance.resolveAppearance('system', false), 'paper');
  assert.equal(appearance.resolveAppearance('sand', true), 'sand');
});
test('selection persists across initialization, follows OS only in system mode, and reports failed saves', () => {
  const values = new Map(), properties = new Map(), events = {};
  const media = { matches: false, addEventListener: (_, fn) => { events.media = fn; } };
  global.document = { documentElement: { dataset: {}, style: { setProperty: (key, value) => properties.set(key, value) } } };
  global.window = { localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }, matchMedia: () => media, addEventListener: (key, fn) => { events[key] = fn; } };
  try {
    appearance.initializeAppearance();
    assert.equal(document.documentElement.dataset.theme, 'paper');
    assert.equal(appearance.setAppearance('sand'), true);
    appearance.initializeAppearance();
    assert.equal(appearance.getAppearance(), 'sand');
    media.matches = true; events.media();
    assert.equal(document.documentElement.dataset.theme, 'sand');
    appearance.setAppearance('system');
    assert.equal(document.documentElement.dataset.theme, 'night');
    media.matches = false; events.media();
    assert.equal(document.documentElement.dataset.theme, 'paper');
    events.storage({ key: appearance.APPEARANCE_KEY, newValue: 'sage' });
    assert.equal(document.documentElement.dataset.theme, 'sage');
    window.localStorage.setItem = () => { throw Error('Disk full'); };
    assert.equal(appearance.setAppearance('night'), false);
    assert.equal(document.documentElement.dataset.theme, 'night');
    assert.equal(properties.get('--ui-text'), appearance.palettes.night.text);
    assert.deepEqual([...values.keys()], [appearance.APPEARANCE_KEY]);
  } finally { delete global.window; delete global.document; }
});
