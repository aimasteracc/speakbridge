// Formatting only: never guess or replace names, words, or missing speech.
// Keep ambiguous spoken quantities (一百二、两三) and idioms unchanged.
const digits = { 零:0, 〇:0, 一:1, 二:2, 两:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9 };
function smallNumber(text) {
  if (/^[零〇一二三四五六七八九]$/.test(text)) return digits[text];
  if (/^[一二三四五六七八九]?十[一二三四五六七八九]?$/.test(text)) {
    const [tens, ones] = text.split('十'); return (tens ? digits[tens] : 1) * 10 + (ones ? digits[ones] : 0);
  }
  return null;
}
function formatChineseNumbers(text, language) {
  if (language !== 'zh') return text;
  return text
    .replace(/[零〇一二三四五六七八九]{4}(?=年)/g, value => Array.from(value, c => digits[c]).join(''))
    .replace(/(?<=[0-9]{4}年)[一二三四五六七八九十]{1,3}(?=月)/g, value => { const n=smallNumber(value); return n>=1&&n<=12 ? String(n) : value; })
    .replace(/(?<=[0-9]{1,2}月)[一二三四五六七八九十]{1,3}(?=[日号])/g, value => { const n=smallNumber(value); return n>=1&&n<=31 ? String(n) : value; });
}
// Apply to a complete hypothesis, never individual streaming tokens: a token
// such as “。” still belongs to preceding words in the same hypothesis.
function cleanSpeechText(text) {
  return /^[\p{P}\p{Z}\s\u200B\uFEFF]*$/u.test(text) ? '' : text;
}
module.exports = { formatChineseNumbers, cleanSpeechText };
