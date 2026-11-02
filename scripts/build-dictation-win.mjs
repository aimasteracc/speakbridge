import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const base = fileURLToPath(new URL('../electron/native/', import.meta.url));
const source = path.join(base, 'dictation-win.cs'), output = path.join(base, 'dictation-win.exe'), manifest = path.join(base, 'dictation-win.build.json');
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const sourceHash = hash(source);
let valid = false;
try { const previous = JSON.parse(readFileSync(manifest)); valid = previous.sourceSHA256 === sourceHash && previous.binarySHA256 === hash(output); } catch {}
if (!valid) {
  const assemblies = ['mscorlib', 'System', 'System.Core', 'System.Web.Extensions', 'UIAutomationClient', 'UIAutomationTypes', 'WindowsBase'];
  if (process.platform === 'win32') {
    const framework = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319');
    execFileSync(path.join(framework, 'csc.exe'), ['/nologo', '/target:exe', '/platform:x64', '/optimize+', '/out:' + output,
      '/reference:System.Web.Extensions.dll', ...['UIAutomationClient', 'UIAutomationTypes', 'WindowsBase'].map(name => '/reference:' + path.join(framework, 'WPF', name + '.dll')), source], { stdio: 'inherit', windowsHide: true });
  } else {
    const sdk = process.env.SPEAKBRIDGE_DOTNET_DIR, refs = process.env.SPEAKBRIDGE_NET48_REFS;
    if (!sdk || !refs) throw Error('Windows helper is missing or stale. Build on Windows, or set SPEAKBRIDGE_DOTNET_DIR and SPEAKBRIDGE_NET48_REFS (see DICTATION-0.6.md).');
    const versions = readdirSync(path.join(sdk, 'sdk')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const compiler = path.join(sdk, 'sdk', versions.at(-1), 'Roslyn', 'bincore', 'csc.dll');
    execFileSync(path.join(sdk, 'dotnet'), [compiler, '/nologo', '/noconfig', '/nostdlib+', '/langversion:5', '/target:exe', '/platform:x64', '/optimize+', '/out:' + output,
      ...assemblies.map(name => '/reference:' + path.join(refs, name + '.dll')), source], { stdio: 'inherit', env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1' } });
  }
  writeFileSync(manifest, JSON.stringify({ sourceSHA256: sourceHash, binarySHA256: hash(output), target: 'net48-x64' }, null, 2) + '\n');
}
