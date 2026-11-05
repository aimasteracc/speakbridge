const { exportSession } = require('./core.cjs');
const escape = value => String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const text = node => node.value || node.alt || (node.children || []).map(text).join('');
async function tree(session) { const [{ unified }, { default: parse }, { default: gfm }] = await Promise.all([import('unified'), import('remark-parse'), import('remark-gfm')]); return unified().use(parse).use(gfm).parse(session.notes || exportSession(session, 'md')); }
function htmlNode(node) {
  const inside = () => (node.children || []).map(htmlNode).join('');
  switch (node.type) {
    case 'root': return inside();
    case 'heading': return `<h${node.depth}>${inside()}</h${node.depth}>`;
    case 'paragraph': return `<p>${inside()}</p>`;
    case 'strong': return `<strong>${inside()}</strong>`;
    case 'emphasis': return `<em>${inside()}</em>`;
    case 'delete': return `<s>${inside()}</s>`;
    case 'list': return `<${node.ordered ? 'ol' : 'ul'}>${inside()}</${node.ordered ? 'ol' : 'ul'}>`;
    case 'listItem': return `<li>${node.checked === true ? '☑ ' : node.checked === false ? '☐ ' : ''}${inside()}</li>`;
    case 'table': return `<table><thead>${htmlRow(node.children[0], true)}</thead><tbody>${node.children.slice(1).map(n => htmlRow(n, false)).join('')}</tbody></table>`;
    case 'blockquote': return `<blockquote>${inside()}</blockquote>`;
    case 'code': return `<pre><code>${escape(node.value)}</code></pre>`;
    case 'inlineCode': return `<code>${escape(node.value)}</code>`;
    case 'thematicBreak': return '<hr>';
    case 'break': return '<br>';
    case 'link': return inside(); // Exports never fetch or execute model-provided URLs.
    default: return escape(node.value || node.alt || '');
  }
}
function htmlRow(row, header) { const tag = header ? 'th' : 'td'; return '<tr>' + row.children.map(cell => `<${tag}>${cell.children.map(htmlNode).join('')}</${tag}>`).join('') + '</tr>'; }
async function documentHTML(session) {
  return `<!doctype html><html lang="${['zh', 'ja', 'en'].includes(session.notesLanguage) ? session.notesLanguage : 'zh'}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escape(session.title)}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Yu Gothic","Microsoft YaHei",sans-serif;font-size:11pt;line-height:1.7;color:#25332c;margin:0}h1{font-size:24pt}h2{font-size:17pt;border-bottom:1px solid #cdd7d0;padding-bottom:6px}h3{font-size:13pt}h1,h2,h3{break-after:avoid}table{border-collapse:collapse;width:100%;font-size:10pt;margin:16px 0}th,td{border:1px solid #c8d1cc;padding:7px 10px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eef3ef}tr{break-inside:avoid}thead{display:table-header-group}p{overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:12px;background:#f4f6f4}blockquote{border-left:3px solid #c8d6cd;margin-left:0;padding-left:15px;color:#57645d}img{display:none}</style></head><body>${htmlNode(await tree(session))}</body></html>`;
}
async function documentDOCX(session) {
  const { Document, Paragraph, TextRun, Table, TableRow, TableCell, Packer, WidthType, HeadingLevel } = require('docx');
  function runs(node, style = {}) {
    if (node.type === 'strong') style = { ...style, bold: true };
    if (node.type === 'emphasis') style = { ...style, italics: true };
    if (node.type === 'delete') style = { ...style, strike: true };
    if (node.type === 'inlineCode') style = { ...style, font: 'Consolas' };
    if (node.type === 'break') return [new TextRun({ break: 1 })];
    return node.children ? node.children.flatMap(n => runs(n, style)) : [new TextRun({ text: node.value || node.alt || '', ...style })];
  }
  function blocks(node, level = 0) {
    if (node.type === 'root' || node.type === 'blockquote') return node.children.flatMap(n => blocks(n, level));
    if (node.type === 'table') return [new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: node.children.map((row, i) => new TableRow({ tableHeader: i === 0, children: row.children.map(cell => new TableCell({ children: [new Paragraph({ children: runs(cell, { bold: i === 0 }) })], ...(i === 0 ? { shading: { fill: 'EEF3EF' } } : {}) })) })) })];
    if (node.type === 'list') return node.children.flatMap((item, i) => item.children.flatMap((n, j) => n.type === 'list' ? blocks(n, level + 1) : [new Paragraph({ children: [new TextRun(j ? '' : node.ordered ? `${i + (node.start || 1)}. ` : item.checked === true ? '☑ ' : item.checked === false ? '☐ ' : '• '), ...runs(n)], indent: { left: 300 * (level + 1) }, spacing: { after: 100 } })]));
    if (node.type === 'thematicBreak') return [new Paragraph({ text: '────────────────', spacing: { after: 120 } })];
    return [new Paragraph({ children: node.type === 'code' ? [new TextRun({ text: text(node), font: 'Consolas' })] : runs(node), ...(node.type === 'heading' ? { heading: HeadingLevel['HEADING_' + node.depth] } : {}), spacing: { after: 160 } })];
  }
  const doc = new Document({ creator: 'SpeakBridge', title: session.title, styles: { default: { document: { run: { font: 'Arial', size: 22 }, paragraph: { spacing: { line: 320 } } } } }, sections: [{ children: blocks(await tree(session)) }] });
  return Packer.toBuffer(doc);
}
module.exports = { documentHTML, documentDOCX };
