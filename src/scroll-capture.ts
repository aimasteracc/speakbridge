// Compare overlapping rows, using sparse pixels to keep matching local and bounded.
// The user scrolls the chosen content area; uncertain joins are rejected.
export function scrollOffset(previous: ImageData, current: ImageData): number | null {
  const { width, height } = previous; if (width !== current.width || height !== current.height) return null;
  const score = (offset: number) => { let sum = 0, count = 0; for (let y = 0; y < height - offset; y += 7) for (let x = 4; x < width - 4; x += 29) { const a = ((y + offset) * width + x) * 4, b = (y * width + x) * 4; for (let c = 0; c < 3; c++) { sum += Math.abs(previous.data[a + c] - current.data[b + c]); count++; } } return count ? sum / count : Infinity; };
  if (score(0) < 1.2) return 0;
  let best = Infinity, offset = 0;
  for (let shift = 8; shift <= height * .85; shift++) { const error = score(shift); if (error < best) { best = error; offset = shift; } }
  if (best > 9) return null;
  return offset;
}
