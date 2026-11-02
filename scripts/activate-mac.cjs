// Open a verified release only while the user's app is closed and history is idle.
// Never quits an existing process, records audio, or changes the user's settings.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'), version = require('../package.json').version;
const app = path.join(root, 'release', version, process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'SpeakBridge.app');
const binary = path.join(app, 'Contents/MacOS/SpeakBridge');
const data = path.join(require('node:os').homedir(), 'Library/Application Support/SpeakBridge');
const names = ['settings.json', 'sessions.json', 'credential.json', 'soniox-credential.json'];
const hash = name => { const file = path.join(data, name); return fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null; };
function running() { return execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n').map(line => line.trim().match(/^(\d+)\s+(.+)$/)).filter(match => match && match[2].includes('/SpeakBridge.app/Contents/MacOS/SpeakBridge') && !match[2].includes('--user-data-dir=')); }
(async () => {
  assert.equal(process.platform, 'darwin'); assert.ok(fs.existsSync(binary));
  const sessions = JSON.parse(fs.readFileSync(path.join(data, 'sessions.json')));
  if (sessions.some(row => !row.endedAt) || running().length) {
    const result = { version, activationDeferred: true, reason: 'Existing app or recording is active; no process or settings changed.', appPath: path.relative(root, app) };
    fs.writeFileSync(path.join(root, 'test-artifacts', `user-install-${version}-result.json`), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result)); return;
  }
  const before = Object.fromEntries(names.map(name => [name, hash(name)]));
  execFileSync('open', ['-a', app]);
  let processes;
  for (let attempt = 0; attempt < 50; attempt++) { processes = running(); if (processes.some(match => match[2] === binary)) break; await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.ok(processes.some(match => match[2] === binary), 'Expected release must be running');
  const after = Object.fromEntries(names.map(name => [name, hash(name)]));
  const settings = JSON.parse(fs.readFileSync(path.join(data, 'settings.json')));
  const result = { version, activationDeferred: false, appPath: path.relative(root, app), running: true, localModel: settings.localModel, unchangedFiles: Object.fromEntries(names.map(name => [name, before[name] === after[name]])), time: new Date().toISOString() };
  fs.writeFileSync(path.join(root, 'test-artifacts', `user-install-${version}-result.json`), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
})().catch(error => { console.error(error); process.exitCode = 1; });
