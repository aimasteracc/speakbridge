const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const os = require('node:os');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '..'), version = require('../package.json').version;
const release = path.join(root, 'release', version);
const hash = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
function files(folder) { return fs.readdirSync(path.join(root, folder), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(folder + '/' + entry.name) : [folder + '/' + entry.name]); }
const source = [...files('electron'), ...files('dist'), ...files('licenses'), 'LICENSE', 'THIRD_PARTY_NOTICES.md'];
const checks = [];
const requested = new Set(process.argv.slice(2));
const targets = [
  ['darwin-arm64', 'mac-arm64/SpeakBridge.app/Contents/Resources', /arm64/],
  ['darwin-x64', 'mac/SpeakBridge.app/Contents/Resources', /x86_64/],
  ['win-x64', 'win-unpacked/resources', /x86-64/],
  ['win-arm64', 'win-arm64-unpacked/resources', /Aarch64|ARM64|aarch64/],
];
if ([...requested].some(name => !targets.some(x => x[0] === name))) throw new Error('Unknown package target');
// Signing changes Mach-O signature bytes, but must not change executable code.
function unsignedHash(buffer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'speakbridge-signature-check-'));
  try {
    const file = path.join(dir, 'binary'); fs.writeFileSync(file, buffer);
    execFileSync('codesign', ['--remove-signature', file], { stdio: 'pipe' });
    const stripped = fs.readFileSync(file);
    assert.equal(stripped.readUInt32LE(0), 0xfeedfacf, 'expected 64-bit Mach-O');
    // codesign leaves the signature-expanded __LINKEDIT virtual allocation behind.
    // Ignore only that allocation size; compare all executable/data bytes and other metadata.
    let offset = 32;
    for (let i = 0; i < stripped.readUInt32LE(16); i++) {
      const command = stripped.readUInt32LE(offset), size = stripped.readUInt32LE(offset + 4);
      assert.ok(size >= 8 && offset + size <= stripped.length);
      if (command === 0x19 && stripped.subarray(offset + 8, offset + 24).toString().replace(/\0/g, '') === '__LINKEDIT') stripped.writeBigUInt64LE(0n, offset + 32);
      offset += size;
    }
    return hash(stripped);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
for (const [platform, resources, pattern] of targets.filter(x => !requested.size || requested.has(x[0]))) {
  const archive = path.join(release, resources, 'app.asar');
  let codeSignature = null;
  if (platform.startsWith('darwin-')) {
    const bundle = path.resolve(release, resources, '../..');
    execFileSync('codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'pipe' });
    const identifier = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', path.join(bundle, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
    assert.equal(identifier, require('../package.json').build.appId);
    // Verify the signature's identifier as well as Info.plist; stale Electron signatures fail this.
    const signature = spawnSync('codesign', ['-dvv', bundle], { encoding: 'utf8' });
    assert.equal(signature.status, 0);
    assert.match(signature.stderr, new RegExp('^Identifier=' + identifier.replace(/\./g, '\\.') + '$', 'm'));
    codeSignature = { deepStrictVerified: true, identifier };
  }
  for (const file of source) {
    const digest = platform.startsWith('darwin-') && /^electron\/native\/dictation-mac-/.test(file) ? unsignedHash : hash;
    assert.equal(digest(asar.extractFile(archive, file)), digest(fs.readFileSync(path.join(root, file))), `${platform}: ${file}`);
  }
  assert.equal(JSON.parse(asar.extractFile(archive, 'package.json')).version, version);
  const nativeVersion = JSON.parse(asar.extractFile(archive, 'node_modules/sherpa-onnx-node/package.json')).version;
  assert.equal(nativeVersion, '2.0.1');
  const native = path.join(archive + '.unpacked', 'node_modules', 'sherpa-onnx-' + platform, 'sherpa-onnx.node');
  const arch = execFileSync('file', [native], { encoding: 'utf8' }).trim(); assert.match(arch, pattern);
  const helper = path.join(archive + '.unpacked', 'electron/native', platform.startsWith('win-') ? 'dictation-win.exe' : 'dictation-mac-' + platform.split('-')[1]);
  const inputHelperArch = execFileSync('file', [helper], { encoding: 'utf8' }).trim();
  if (platform.startsWith('win-')) {
    assert.match(inputHelperArch, /Mono\/\.Net assembly/); assert.equal(JSON.parse(asar.extractFile(archive, 'electron/native/dictation-win.build.json')).target, 'net48-anycpu');
    const pe = fs.readFileSync(helper), coff = pe.readUInt32LE(0x3c), optional = coff + 24, sections = pe.readUInt16LE(coff + 6);
    assert.equal(pe.readUInt16LE(optional), 0x10b); const cliRva = pe.readUInt32LE(optional + 96 + 14 * 8); let flags;
    for (let i = 0; i < sections; i++) { const offset = optional + pe.readUInt16LE(coff + 20) + i * 40, rva = pe.readUInt32LE(offset + 12), length = pe.readUInt32LE(offset + 16); if (cliRva >= rva && cliRva < rva + length) flags = pe.readUInt32LE(pe.readUInt32LE(offset + 20) + cliRva - rva + 16); }
    assert.notEqual(flags, undefined); assert.equal(flags & 0x20002, 0, 'AnyCPU must not require/prefer 32 bit');
  } else assert.match(inputHelperArch, pattern);
  checks.push({ platform, sourceFilesMatched: source.length, nativeVersion, arch: arch.replace(root + path.sep, ''), inputHelperArch: inputHelperArch.replace(root + path.sep, ''), codeSignature });
}
const hashes = [];
for (const name of fs.readdirSync(release).filter(name => name.endsWith('.zip') && (!requested.size || [...requested].some(target => name.endsWith('-' + target.replace('darwin', 'mac') + '.zip')))).sort()) {
  execFileSync('unzip', ['-tq', path.join(release, name)], { stdio: 'pipe' });
  hashes.push(hash(fs.readFileSync(path.join(release, name))) + '  ' + name);
}
assert.equal(hashes.length, checks.length); fs.writeFileSync(path.join(release, 'SHA256SUMS.txt'), hashes.join('\n') + '\n');
const result = { version, checks, zipIntegrity: true };
fs.writeFileSync(path.join(root, 'test-artifacts', `package-${version}-verification.json`), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
