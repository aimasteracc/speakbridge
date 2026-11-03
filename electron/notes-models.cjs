// Verified 2026-11-03 against the vendors' model/API documentation.
// Unknown models have no invented context limit; a deployment can override it.
// https://api-docs.deepseek.com/quick_start/pricing/
// https://developers.openai.com/api/docs/models/gpt-4.1-mini
function notesModelBudget(settings = {}, provider = settings.textProvider) {
  const model = provider === 'ollama' ? settings.ollamaModel : settings.translationModel;
  let contextTokens = 0, maxOutputTokens = 0, known = false;
  if (provider === 'api' && /^deepseek-(flash|v4-pro|v4-flash)(?:$|-)/.test(model || '')) {
    contextTokens = 1000000; maxOutputTokens = 384000; known = true;
  } else if (provider === 'api' && /^gpt-4\.1(?:-mini|-nano)?(?:$|-20)/.test(model || '')) {
    contextTokens = 1047576; maxOutputTokens = 32768; known = true;
  }
  contextTokens = settings.notesContextTokens || contextTokens;
  const outputTokens = settings.notesOutputTokens || Math.min(32768, maxOutputTokens || 16384, contextTokens ? Math.max(1024, Math.floor(contextTokens / 4)) : Infinity);
  if (maxOutputTokens && outputTokens > maxOutputTokens) throw new Error(`纪要输出预算超过 ${model} 的 ${maxOutputTokens.toLocaleString()} token 上限。`);
  if (contextTokens && outputTokens + 2048 >= contextTokens) throw new Error('纪要输出预算过大，请为原文和提示词保留上下文空间。');
  let deepseek = false;
  try { deepseek = provider === 'api' && new URL(settings.baseUrl).hostname === 'api.deepseek.com' && /^deepseek-/.test(model); } catch {}
  return { model: model || provider || '默认模型', known, contextTokens, maxOutputTokens, outputTokens,
    timeoutMs: (settings.notesTimeoutSeconds || 600) * 1000,
    automaticOutput: !settings.notesOutputTokens, deepseek,
    source: settings.notesContextTokens ? '手动设置' : known ? '模型官方标称容量' : '由服务端判断（可在设置中填写容量）' };
}

// A planning estimate, NOT a tokenizer or an exact provider count. We include
// the JSON envelope/prompt and reserve room for output. The API is authoritative.
function estimateTokens(text) {
  let estimate = 0;
  for (const char of text) {
    const code = char.codePointAt(0);
    estimate += code > 0xffff ? 4 : code > 127 ? 1.5 : /\s/.test(char) ? .25 : .35;
  }
  return Math.ceil(estimate);
}

function splitByTokens(text, budget) {
  if (!Number.isFinite(budget) || budget < 1024) throw new Error('模型的可用输入预算过小，无法整理纪要。');
  const result = []; let part = '', tokens = 0;
  // Retain every character, including newlines and surrogate pairs.
  for (const line of text.match(/[^\n]*\n|[^\n]+$/g) || []) {
    const count = estimateTokens(line);
    if (count <= budget) {
      if (part && tokens + count > budget) { result.push(part); part = ''; tokens = 0; }
      part += line; tokens += count;
    } else {
      for (const char of line) {
        const count = estimateTokens(char);
        if (part && tokens + count > budget) { result.push(part); part = ''; tokens = 0; }
        part += char; tokens += count;
      }
    }
  }
  if (part) result.push(part);
  return result;
}
module.exports = { notesModelBudget, estimateTokens, splitByTokens };
