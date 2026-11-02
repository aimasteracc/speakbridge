import './build-dictation-win.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
const source = new URL('../native/dictation-mac.swift', import.meta.url);
const output = new URL('../electron/native/', import.meta.url);
if (process.platform === 'darwin') {
  mkdirSync(output, { recursive: true });
  for (const arch of ['arm64', 'x86_64']) {
    const file = new URL(`dictation-mac-${arch === 'x86_64' ? 'x64' : arch}`, output);
    let current = false; try { current = statSync(file).mtimeMs >= statSync(source).mtimeMs; } catch {}
    if (!current) execFileSync('xcrun', ['swiftc', '-O', '-target', `${arch}-apple-macos13.0`, source.pathname, '-o', file.pathname], { stdio: 'inherit' });
  }
}
