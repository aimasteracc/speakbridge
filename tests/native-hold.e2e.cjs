const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
if (process.platform !== 'darwin') { console.log('Native hold integration requires macOS.'); process.exit(0); }
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'speakbridge-native-hold-'));
const emitter = path.join(directory, 'emit');
execFileSync('xcrun', ['swiftc', path.join(__dirname, 'native-hold-events.swift'), '-o', emitter]);
const helper = process.env.SPEAKBRIDGE_NATIVE_HELPER || path.join(__dirname, '../electron/native/dictation-mac-' + process.arch);
const child = spawn(helper, [], { stdio: ['pipe', 'pipe', 'inherit'] });
let buffer = '', sequence = 0;
const pending = new Map(), events = [];
child.stdout.setEncoding('utf8'); child.stdout.on('data', data => {
  buffer += data;
  let end;
  while ((end = buffer.indexOf('\n')) >= 0) {
    const item = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
    if (item.id) { const resolve = pending.get(item.id); pending.delete(item.id); resolve?.(item); }
    else events.push(item);
  }
});
async function request(op, key) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('No native reply: ' + op)), 3000);
    pending.set(id, value => { clearTimeout(timer); resolve(value); });
    child.stdin.write(JSON.stringify({ id, op, key }) + '\n');
  });
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function emit(key, edge) { execFileSync(emitter, [key, edge]); await pause(80); }
(async () => {
  try {
    const status = await request('status');
    assert.equal(status.available, true, 'Native test requires Accessibility permission');
    const checks = [];
    for (const key of ['fn', 'rightalt', 'rightctrl']) {
      const watch = await request('watch', key);
      if (key === 'fn' && watch.conflict) {
        assert.equal(watch.available, false);
        assert.match(watch.message, /原版 Speakly/);
        checks.push('fn conflict blocked; no Fn events emitted');
        continue;
      }
      assert.equal(watch.available, true);
      const start = events.length;
      await emit(key, 'down'); await emit(key, 'down');
      // Requests keep working while a key is held; clear must not stop watch.
      assert.equal((await request('clear')).ok, true);
      await emit(key, 'up');
      assert.deepEqual(events.slice(start), [{ event: 'hold', pressed: true }, { event: 'hold', pressed: false }], key + ' exact edges/no repeat');
      checks.push(key + ' edges/no repeats/clear preserves watch');
    }
    assert.equal((await request('watch', 'rightctrl')).available, true);
    await emit('rightctrl', 'down');
    const start = events.length;
    assert.equal((await request('watch', 'off')).available, false);
    assert.deepEqual(events.slice(start), [{ event: 'hold', pressed: false }], 'disabling releases an active hold');
    await emit('rightctrl', 'up');
    assert.deepEqual(events.slice(start), [{ event: 'hold', pressed: false }], 'disabled watcher is silent');
    assert.equal((await request('watch', 'bogus')).ok, false);
    console.log(JSON.stringify({ ok: true, checks: [...checks, 'disable releases hold', 'invalid key rejected'], helper }, null, 2));
  } finally {
    await request('watch', 'off').catch(() => {});
    child.stdin.end();
    await new Promise(resolve => { child.once('exit', resolve); setTimeout(() => { child.kill(); resolve(); }, 1000).unref(); });
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
