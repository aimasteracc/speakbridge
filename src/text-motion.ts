const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const split = (text: string) => Array.from(graphemes.segment(text), item => item.segment);

// Same whole-hypothesis rule as electron/speech-text.cjs. Also hides old
// punctuation-only rows without rewriting the user's saved history.
export const hasSpeechText = (text: string) => !/^[\p{P}\p{Z}\s\u200B\uFEFF]*$/u.test(text);

export function revealPlan(visible: string, target: string) {
  const before = split(visible), after = split(target);
  if (after.length <= before.length) return null;
  if (!target.startsWith(visible)) {
    let tail = 0;
    while (tail < before.length && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
    // An insertion in the middle with an unchanged word at the end is a
    // correction: preserve that ending immediately. A provisional final “。”
    // alone is not such an ending; SenseVoice rewrites it on almost every batch.
    if (tail && /[\p{L}\p{N}\p{S}]/u.test(after.slice(-tail).join(''))) return null;
  }
  // Replace already visible positions immediately with the newest hypothesis;
  // only the growth beyond them is paced. No known-wrong text stays queued.
  const units = after.slice(before.length);
  return { prefix: after.slice(0, before.length).join(''), units, duration: Math.min(360, units.length * 28) };
}

// Compare display text only. Never normalize or rewrite recognizer output.
export function textChange(previous: string, next: string) {
  const before = split(previous), after = split(next);
  let head = 0, tail = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  while (tail < before.length - head && tail < after.length - head && before[before.length - tail - 1] === after[after.length - tail - 1]) tail++;
  const added = after.slice(head, after.length - tail);
  // Bound DOM/animation work even when a provider returns a long paragraph.
  const width = Math.max(1, Math.ceil(added.length / 24));
  const chunks: string[] = [];
  for (let i = 0; i < added.length; i += width) chunks.push(added.slice(i, i + width).join(''));
  return { head: after.slice(0, head).join(''), chunks, tail: tail ? after.slice(-tail).join('') : '', revised: head + tail < before.length };
}
