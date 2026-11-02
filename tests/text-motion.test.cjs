const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../src/text-motion.ts');
test('append reveal is bounded, Unicode-safe and corrections bypass the queue', async () => {
  const { revealPlan } = await load();
  assert.equal(revealPlan('错误内容', '正确内容'), null);
  assert.equal(revealPlan('较长的内容', '短句'), null);
  const plan = revealPlan('已有', '已有👩🏽‍💻é继续');
  assert.deepEqual(plan.units, ['👩🏽‍💻', 'é', '继', '续']);
  assert.equal(plan.prefix + plan.units.join(''), '已有👩🏽‍💻é继续');
  assert.ok(revealPlan('', '长句'.repeat(1000)).duration <= 360);
  const continued = revealPlan('今天。', '今天继续说话。');
  assert.ok(continued.units.length > 1);
  assert.equal(continued.prefix + continued.units.join(''), '今天继续说话。');
  assert.equal(revealPlan('本次会议在东京', '本次产品会议在东京'), null);
});
test('display diff preserves exact recognized text and animates only the edited range', async () => {
  const { textChange } = await load();
  const r = textChange('今天讨论语音识别的速度。', '今天讨论语音识别的准确率。');
  assert.equal(r.head, '今天讨论语音识别的'); assert.equal(r.tail, '。'); assert.equal(r.chunks.join(''), '准确率'); assert.ok(r.revised);
  for (const [a, b] of [['你好', '你好世界'], ['这是错误答案', '这是答案'], ['abc', ''], ['', ''], ['原文', '完全不同'], ['预算12.5万元', '预算12.8万元']]) {
    const d = textChange(a, b); assert.equal(d.head + d.chunks.join('') + d.tail, b);
  }
});
test('visual updates do not split emoji families, modifiers or combining characters', async () => {
  const { textChange } = await load();
  const r = textChange('Hello ', 'Hello 👩🏽‍💻 é 家庭👨‍👩‍👧‍👦');
  assert.ok(r.chunks.includes('👩🏽‍💻')); assert.ok(r.chunks.includes('é')); assert.ok(r.chunks.includes('👨‍👩‍👧‍👦'));
  assert.equal(r.head + r.chunks.join('') + r.tail, 'Hello 👩🏽‍💻 é 家庭👨‍👩‍👧‍👦');
  assert.equal(textChange('好👩🏽‍💻', '好👩🏻‍💻').head, '好');
});
test('long replacement output has bounded animation nodes and no truncation', async () => {
  const { textChange } = await load(); const text = '长段语音文字。'.repeat(3000);
  const result = textChange('旧句', text); assert.ok(result.chunks.length <= 24);
  assert.equal(result.head + result.chunks.join('') + result.tail, text);
  const unchanged = textChange(text, text); assert.equal(unchanged.chunks.length, 0);
});
