// npm installs only the host's optional ASR binary. Cross-platform packaging
// must prepare every supported target before electron-builder scans dependencies.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const tar = require('tar');
const root = path.resolve(__dirname, '..');
const targets = ['darwin-arm64', 'darwin-x64', 'win-x64', 'win-arm64'];
let preparing;
async function prepare() {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  for (const target of targets) {
    const name = 'sherpa-onnx-' + target, destination = path.join(root, 'node_modules', name);
    const entry = lock.packages['node_modules/' + name];
    if (!entry?.resolved?.startsWith('https://registry.npmjs.org/' + name + '/') || !entry.integrity?.startsWith('sha512-')) throw new Error('Missing pinned native package: ' + name);
    if (fs.existsSync(path.join(destination, 'sherpa-onnx.node')) && JSON.parse(fs.readFileSync(path.join(destination, 'package.json'), 'utf8')).version === entry.version) continue;
    if (fs.existsSync(destination)) throw new Error('Incomplete native package; run npm ci before packaging: ' + name);
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'speakbridge-native-package-'));
    try {
      const response = await fetch(entry.resolved, { signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw new Error('Native package download failed: ' + name);
      const bytes = Buffer.from(await response.arrayBuffer());
      if ('sha512-' + crypto.createHash('sha512').update(bytes).digest('base64') !== entry.integrity) throw new Error('Native package integrity mismatch: ' + name);
      const archive = path.join(temporary, 'package.tgz'), extracted = path.join(temporary, 'extracted');
      fs.writeFileSync(archive, bytes); fs.mkdirSync(extracted);
      await tar.x({ file: archive, cwd: extracted, strip: 1, strict: true, filter: (name, entry) => name.startsWith('package/') && !['SymbolicLink', 'Link'].includes(entry.type) });
      const descriptor = JSON.parse(fs.readFileSync(path.join(extracted, 'package.json'), 'utf8'));
      if (descriptor.name !== name || descriptor.version !== entry.version || !fs.existsSync(path.join(extracted, 'sherpa-onnx.node'))) throw new Error('Native package contents mismatch: ' + name);
      fs.cpSync(extracted, destination, { recursive: true, errorOnExist: true, force: false });
      console.log('Prepared pinned ASR binary: ' + name);
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }
}
module.exports = () => preparing ||= prepare();
if (require.main === module) module.exports().catch(error => { console.error(error.message); process.exitCode = 1; });
