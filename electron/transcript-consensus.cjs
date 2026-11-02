// Conservative three-ASR voting (ROVER-style alignment). Text comes only from
// independent audio decoders. Keep the fast recognizer unless both other models
// agree. Latin words and numbers are atomic; do not splice pieces of names.
function tokens(text) {
  return Array.from(text.matchAll(/\p{Script=Latin}[\p{Script=Latin}\p{M}'’\-]*|\d+(?:[.,]\d+)*|[\p{L}\p{N}]/gu), m => ({
    raw: m[0], key: m[0].normalize('NFKC').toLowerCase(), start: m.index, end: m.index + m[0].length,
  }));
}
function align(a, b) {
  const distance = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = 0; i <= a.length; i++) distance[i][0] = i;
  for (let j = 0; j <= b.length; j++) distance[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    distance[i][j] = Math.min(distance[i-1][j] + 1, distance[i][j-1] + 1, distance[i-1][j-1] + (a[i-1].key === b[j-1].key ? 0 : 1));
  }
  const words = Array(a.length).fill(null), gaps = Array.from({ length: a.length + 1 }, () => []);
  let i = a.length, j = b.length;
  while (i || j) {
    if (i && j && distance[i][j] === distance[i-1][j-1] + (a[i-1].key === b[j-1].key ? 0 : 1)) words[--i] = b[--j];
    else if (i && distance[i][j] === distance[i-1][j] + 1) i--;
    else gaps[i].unshift(b[--j]);
  }
  return { words, gaps, errors: distance[a.length][b.length] };
}
function consensus(base, second, third) {
  const a = tokens(base), b = tokens(second), c = tokens(third);
  if (!a.length || !b.length || !c.length || Math.max(a.length, b.length, c.length) > 800) return base;
  const x = align(a, b), y = align(a, c);
  if (x.errors > Math.max(3, a.length * .5) || y.errors > Math.max(3, a.length * .5)) return base;
  let output = base.slice(0, a[0].start);
  const key = word => word?.key || '';
  for (let i = 0; i <= a.length; i++) {
    const left = x.gaps[i], right = y.gaps[i];
    if (left.length && left.length === right.length && left.every((word, j) => word.key === right[j].key)) {
      const insertion = second.slice(left[0].start, left.at(-1).end);
      if (/[\p{Script=Latin}\d]$/u.test(output) && /^[\p{Script=Latin}\d]/u.test(insertion)) output += ' ';
      output += insertion;
      if (/[\p{Script=Latin}\d]$/u.test(insertion) && /^[\p{Script=Latin}\d]/u.test(a[i]?.raw || '')) output += ' ';
    }
    if (i < a.length) {
      // Preserve base spelling/case when the normalized token already agrees.
      const choice = key(x.words[i]) === key(y.words[i]) && key(x.words[i]) !== a[i].key ? x.words[i] : a[i];
      output += choice?.raw || '';
      output += base.slice(a[i].end, a[i+1]?.start ?? base.length);
    }
  }
  return output.replace(/ {2,}/g, ' ').trim();
}
module.exports = { consensus };
