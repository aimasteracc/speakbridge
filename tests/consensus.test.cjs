const { test } = require('node:test');
const assert = require('node:assert/strict');
const { consensus } = require('../electron/transcript-consensus.cjs');
test('two audio decoders must agree to change a word; disagreements preserve the base', () => {
  assert.equal(consensus('今天讨论语音识另。', '今天讨论语音识别。', '今天讨论语音识别'), '今天讨论语音识别。');
  assert.equal(consensus('今天讨论语音识另。', '今天讨论语音识别。', '今天讨论语音识字'), '今天讨论语音识另。');
  assert.equal(consensus('We met Oravex today.', 'We met Oravec today.', 'We met Oravec today.'), 'We met Oravec today.');
  assert.equal(consensus('We met Oravex today.', 'We met Oravec today.', 'We met Orava today.'), 'We met Oravex today.');
});
test('shared omissions and insertions are aligned without gluing English words', () => {
  assert.equal(consensus('We support Mac.', 'We support Windows and Mac.', 'We support Windows and Mac.'), 'We support Windows and Mac.');
  assert.equal(consensus('今天今天讨论会议。', '今天讨论会议。', '今天讨论会议。'), '今天讨论会议。');
  assert.equal(consensus('今天今天讨论会议。', '今天今天讨论会议。', '今天讨论会议。'), '今天今天讨论会议。');
});
test('formatting, empty alternatives and strongly divergent decodes preserve the base', () => {
  assert.equal(consensus('Hello, Mac!', 'hello mac', 'HELLO MAC'), 'Hello, Mac!');
  assert.equal(consensus('一段正常录音。', '', ''), '一段正常录音。');
  assert.equal(consensus('这是一段需要保留的正常会议录音。', '完全无关', '完全无关'), '这是一段需要保留的正常会议录音。');
  assert.equal(consensus('声'.repeat(801), '声'.repeat(801), '声'.repeat(801)), '声'.repeat(801));
});
