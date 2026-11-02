const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateSettings } = require('../electron/core.cjs');
const { validateLocalSpeech } = require('../electron/local-speech.cjs');
const { assetsInstalled, ASSETS } = require('../electron/model-assets.cjs');
const { formatChineseNumbers } = require('../electron/speech-text.cjs');

test('high accuracy models are explicit choices and absent assets cannot be reported as installed', () => {
  for (const localModel of ['qwen3-asr', 'whisper-turbo']) {
    assert.equal(validateSettings({ localModel }).localModel, localModel);
    assert.equal(assetsInstalled('/nonexistent-speech-models', localModel), false);
    assert.ok(ASSETS[localModel].length >= 3);
    assert.ok(ASSETS[localModel].every(a => a.size > 0 && /^[a-f0-9]{64}$/.test(a.sha256) && a.url.startsWith('https://')));
  }
  assert.throws(() => assetsInstalled('/nonexistent', 'unknown'), /无效/);
});
test('Qwen hotword limit protects audio context, and does not constrain other speech engines', () => {
  const s = validateSettings({ localModel: 'qwen3-asr', sourceLanguage: 'zh', dictionary: ['DeepSeek Harness', 'Codex', '声桥'] });
  assert.doesNotThrow(() => validateLocalSpeech(s));
  assert.throws(() => validateLocalSpeech({ ...s, dictionary: ['语音'.repeat(50)] }), /256 字节/);
  assert.doesNotThrow(() => validateLocalSpeech({ ...s, localModel: 'sensevoice', dictionary: ['语音'.repeat(50)] }));
  assert.doesNotThrow(() => validateLocalSpeech({ ...s, sourceLanguage: 'ja' }));
  assert.throws(() => validateLocalSpeech({ ...s, localModel: 'sensevoice', sourceLanguage: 'fr' }), /该语言/);
});
test('Chinese date formatting preserves numbers, ambiguous quantities, names and other languages', () => {
  assert.equal(formatChineseNumbers('二零一一年八月十五日，到二零一七年三月。', 'zh'), '2011年8月15日，到2017年3月。');
  assert.equal(formatChineseNumbers('一百二、两三个人、一心一意、七十多颗、田中一郎。', 'zh'), '一百二、两三个人、一心一意、七十多颗、田中一郎。');
  assert.equal(formatChineseNumbers('二〇二四年十二月三十一日', 'zh'), '2024年12月31日');
  assert.equal(formatChineseNumbers('二零二四年十三月三十二日', 'zh'), '2024年十三月三十二日');
  assert.equal(formatChineseNumbers('二〇二四年十二月', 'ja'), '二〇二四年十二月');
  assert.equal(formatChineseNumbers('二〇二四年十二月', 'auto'), '二〇二四年十二月');
});
