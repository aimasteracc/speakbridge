const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('Mac target policy accepts explicitly editable groups and rejects secure/read-only controls', { skip: process.platform !== 'darwin' }, () => {
  // Compile the actual pure policy used by the native helper. No AX queries,
  // keyboard events or clipboard access occur in this test.
  const source = fs.readFileSync(path.join(__dirname, '../native/dictation-mac.swift'), 'utf8');
  const policy = source.split('// BEGIN INPUT_TARGET_POLICY')[1].split('// END INPUT_TARGET_POLICY')[0];
  const checks = [
    ['AXTextArea', '', 'nil', 'nil', 'nil', true],
    ['AXGroup', '', 'true', 'true', 'false', true],
    ['AXUnknown', '', 'true', 'true', 'nil', true],
    ['AXGroup', '', 'true', 'nil', 'nil', false],
    ['AXTextArea', '', 'true', 'false', 'nil', false],
    ['AXTextArea', '', 'true', 'nil', 'true', false],
    ['AXTextField', 'AXSecureTextField', 'true', 'true', 'false', false],
    ['AXSecureTextField', '', 'true', 'true', 'false', false],
    ['AXTextField', '', 'false', 'true', 'false', false],
    ['AXWindow', '', 'true', 'true', 'false', false],
  ].map(([role, subrole, enabled, editable, readOnly, expected], i) =>
    `precondition(acceptsInputTarget(role: "${role}", subrole: "${subrole}", enabled: ${enabled}, editable: ${editable}, readOnly: ${readOnly}) == ${expected}, "case ${i}")`).join('\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'speakbridge-policy-'));
  try {
    const file = path.join(dir, 'policy.swift');
    const nested = `
let roles = ["AXGroup", "AXTextField"]
let secure = focusedTargetIndex(roles: roles, subroles: ["", "AXSecureTextField"])!
precondition(secure == 1 && !acceptsInputTarget(role: roles[secure], subrole: "AXSecureTextField", enabled: true, editable: true, readOnly: false))
let leaf = focusedTargetIndex(roles: roles, subroles: ["", ""])!
precondition(leaf == 1 && !acceptsInputTarget(role: roles[leaf], subrole: "", enabled: true, editable: false, readOnly: true))
precondition(acceptsInputTarget(role: roles[leaf], subrole: "", enabled: true, editable: true, readOnly: false))
precondition(focusedTargetIndex(roles: ["AXGroup", "AXTextField"], subroles: ["AXSecureTextField", ""]) == 0)
`;
    fs.writeFileSync(file, policy + '\n' + checks + '\n' + nested + '\nprint("14 policy cases passed")\n');
    const output = execFileSync('xcrun', ['swift', file], { encoding: 'utf8', timeout: 60000 });
    assert.match(output, /14 policy cases passed/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
