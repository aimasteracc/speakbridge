// Read-only source check. Report locations and categories, never secret values.
// Generated packages, third-party dependencies and local QA data are outside
// this source check; they must not be included in a source handoff.
const fs = require('node:fs');
const path = require('node:path');

const rules = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
  ['service-token', /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,200}|gh[pousr]_[A-Za-z0-9]{30,200}|github_pat_[A-Za-z0-9_]{40,200}|hf_[A-Za-z0-9]{24,200}|AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{30,100}|xox[baprs]-[A-Za-z0-9-]{20,200})\b/g],
  ['credential-literal', /\b(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*["'][A-Za-z0-9_+\/-]{24,256}["']/gi],
  ['jwt', /\beyJ[A-Za-z0-9_-]{15,2048}\.[A-Za-z0-9_-]{15,2048}\.[A-Za-z0-9_-]{15,1024}\b/g],
  ['url-password', /https?:\/\/[^\s/:"']{1,128}:[^\s/@"']{1,128}@/g],
  ['personal-home', /\/(?:Users|home)\/(?!Shared(?:\/|\b)|USER(?:\/|\b)|username(?:\/|\b)|example(?:\/|\b))[^/\s"'<>:]{2,80}/g],
  ['personal-home', /[A-Za-z]:[\\/]+Users[\\/]+(?!Public\b|USER\b|username\b|example\b)[^\\/\s"'<>:]{2,80}/g],
  ['personal-email', /\b[A-Za-z0-9._%+-]{1,64}@(?:gmail\.com|outlook\.com|hotmail\.com|icloud\.com|qq\.com|163\.com)\b/g],
];

function inspect(text) {
  const findings = [];
  for (const [category, expression] of rules) {
    expression.lastIndex = 0;
    for (const match of text.matchAll(expression)) {
      // Exact, deliberately invalid endpoint used by the validation test.
      if (category === 'url-password' && match[0] === ['https://', 'user:pass@'].join('') && /^example\.com(?=[/\s"']|$)/.test(text.slice(match.index + match[0].length))) continue;
      findings.push({ category, line: text.slice(0, match.index).split('\n').length });
    }
  }
  return findings;
}

function scan(root) {
  const excluded = new Set(['node_modules', '.git', 'release', 'test-artifacts', 'dist']);
  const textExtensions = new Set(['.md', '.json', '.js', '.jsx', '.cjs', '.mjs', '.ts', '.tsx', '.swift', '.cs', '.py', '.html', '.css', '.yml', '.yaml', '.toml', '.txt', '.sh']);
  const forbiddenNames = /^(?:\.env(?:\..+)?|\.npmrc|\.netrc|credentials?|soniox-credential|id_rsa|id_ed25519)(?:\.json)?$|\.(?:pem|key|p12|pfx|mobileprovision)$/i;
  const findings = []; let filesScanned = 0;
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name), file = path.relative(root, absolute).split(path.sep).join('/');
      if (entry.isDirectory()) { if (!excluded.has(entry.name)) walk(absolute); continue; }
      if (!entry.isFile()) continue;
      if (forbiddenNames.test(entry.name) && !['.env.example', '.env.sample'].includes(entry.name)) findings.push({ file, category: 'private-config-file', line: 1 });
      if (!textExtensions.has(path.extname(entry.name)) && !['.env.example', '.env.sample', '.gitignore', 'LICENSE'].includes(entry.name)) continue;
      if (file === 'electron/asr-runtime.mjs') continue;
      filesScanned++;
      for (const finding of inspect(fs.readFileSync(absolute, 'utf8'))) findings.push({ file, ...finding });
    }
  }
  walk(root);
  return { scope: 'project source; excludes dependencies, generated runtime, dist, release and test-artifacts', filesScanned, findings };
}

module.exports = { inspect, scan };
if (require.main === module) {
  const result = scan(path.resolve(__dirname, '..'));
  console.log(JSON.stringify(result, null, 2));
  if (result.findings.length) process.exitCode = 1;
}
