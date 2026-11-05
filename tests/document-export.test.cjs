const test = require('node:test');
const assert = require('node:assert/strict');
const { documentDOCX, documentHTML } = require('../electron/document-export.cjs');
const sample = { title: '中日会议', notesLanguage: 'ja', notes: '# 会議記録\n\n## 決定事項\n\n| 担当 | 内容 |\n| --- | --- |\n| 未定 | 中文と日本語を確認する |\n\n- **太字** と *斜体*\n\n<script>fetch("https://example.com")</script>\n\n![image](https://example.com/image.png)' };
test('PDF document markup retains tables and neutralizes executable content and remote assets', async () => {
  const html = await documentHTML(sample); assert.match(html, /<table>/); assert.match(html, /中文と日本語/); assert.match(html, /<strong>太字/); assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<img')); assert.match(html, /default-src 'none'/);
});
test('Word exports a real OOXML package containing Unicode and tables', async () => {
  const buffer = await documentDOCX(sample); assert.equal(buffer.toString('ascii', 0, 2), 'PK');
  const zip = new (require('adm-zip'))(buffer), xml = zip.readAsText('word/document.xml');
  assert.match(xml, /<w:tbl>/); assert.match(xml, /中文と日本語/); assert.match(xml, /会議記録/); assert.ok(!zip.getEntry('word/vbaProject.bin'));
});
