const assert = require('node:assert/strict');
const { NativeInput } = require('../electron/dictation.cjs');
const native = new NativeInput(require('node:os').tmpdir());
(async () => {
  try {
    assert.equal((await native.request('watch', { key: 'off' })).ok, true);
    assert.equal((await native.request('workspace-watch', { bindings: {}, keys: false })).available, true);
    const sequence = await native.request('clipboard-sequence'); assert.equal(sequence.ok, true); assert.ok(Number.isFinite(sequence.sequence));
    assert.equal((await native.request('clear')).ok, true);
    console.log('Native protocol: disabled hooks, clipboard change counter and target clearing passed');
  } finally { native.dispose(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
