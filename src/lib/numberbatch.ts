// QUANT_SCALE must match scripts/build-vectors.py (QUANT_SCALE = 127).
export const NUMBERBATCH_QUANT_SCALE = 127;

/** Int8 row -> L2-normalized Float32Array of the same length. */
export function dequantize(row: Int8Array): Float32Array {
  const out = new Float32Array(row.length);
  let n = 0;
  for (let i = 0; i < row.length; i++) {
    const v = row[i] / NUMBERBATCH_QUANT_SCALE;
    out[i] = v;
    n += v * v;
  }
  n = Math.sqrt(n);
  if (n > 0) for (let i = 0; i < out.length; i++) out[i] /= n;
  return out;
}

export function buildIndex(words: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < words.length; i++) m.set(words[i], i);
  return m;
}

/** Dequantized, normalized vector for `word`, or null if absent. */
export function lookup(
  index: Map<string, number>,
  matrix: Int8Array,
  dim: number,
  word: string,
): Float32Array | null {
  const row = index.get(word);
  if (row === undefined) return null;
  return dequantize(matrix.subarray(row * dim, (row + 1) * dim));
}
