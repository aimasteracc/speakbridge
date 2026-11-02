const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { pathToFileURL } = require('node:url');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const ts = require('typescript');
let MarkdownNotes, normalizeNotes;
test.before(async () => {
  const folder = fs.mkdtempSync(path.join(__dirname, '../node_modules/.notes-render-'));
  try {
    const source = fs.readFileSync(path.join(__dirname, '../src/MarkdownNotes.tsx'), 'utf8');
    const output = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    const file = path.join(folder, 'notes.mjs'); fs.writeFileSync(file, output);
    ({ MarkdownNotes, normalizeNotes } = await import(pathToFileURL(file).href));
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
const render = text => renderToStaticMarkup(React.createElement(MarkdownNotes, { text }));
test('Japanese Markdown headings, GFM tables, emphasis and nested lists render as semantic HTML', () => {
  const html = render('# 定例会議\n\n## 1. 会議概要\n\n| 項目 | 内容 |\n| --- | --- |\n| 日時 | 不明 |\n\n- **決定**\n  - REA を確認する\n');
  for (const markup of ['<h1>定例会議</h1>', '<h2>1. 会議概要</h2>', '<table>', '<thead>', '<th>項目</th>', '<td>不明</td>', '<strong>決定</strong>', 'notes-table-scroll']) assert.ok(html.includes(markup), markup);
  assert.equal((html.match(/<ul>/g) || []).length, 2);
});
test('provider output cannot execute HTML, load images, or navigate to local files', () => {
  const html = render('<script>alert(1)</script>\n\n<img src="https://example.com/track" onerror="alert(1)">\n\n![public image](file:///private/test.png)\n\n[local](file:///private/test) [unsafe](javascript:alert%281%29)\n\n```html\n<script>quoted</script>\n```');
  assert.doesNotMatch(html, /<script|<img|href=|src=|onerror=/i);
  assert.ok(html.includes('&lt;script&gt;quoted&lt;/script&gt;')); assert.ok(html.includes('public image'));
});
test('whole Markdown fences are unwrapped without changing embedded code blocks or plain notes', () => {
  const body = '# 会議\n\n```js\nconst x = 1;\n```';
  assert.equal(normalizeNotes('````markdown\n' + body + '\n````'), body);
  assert.equal(normalizeNotes('```js\nconst x = 1;\n```'), '```js\nconst x = 1;\n```');
  assert.ok(render('以前的纪要\n第二行').includes('以前的纪要\n第二行'));
});
