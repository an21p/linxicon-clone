import { describe, it, expect } from 'vitest';
import { dequantize, buildIndex, lookup, NUMBERBATCH_QUANT_SCALE } from '../src/lib/numberbatch';

describe('numberbatch helpers', () => {
  it('dequantizes an int8 row to a unit-norm Float32Array of the same length', () => {
    const row = new Int8Array([NUMBERBATCH_QUANT_SCALE, 0, 0]); // -> [1,0,0] after normalize
    const v = dequantize(row);
    expect(v).toBeInstanceOf(Float32Array);
    expect(v.length).toBe(3);
    const norm = Math.hypot(...v);
    expect(norm).toBeCloseTo(1, 5);
    expect(v[0]).toBeCloseTo(1, 5);
  });

  it('buildIndex maps each word to its row', () => {
    const idx = buildIndex(['cat', 'cow', 'milk']);
    expect(idx.get('cow')).toBe(1);
    expect(idx.has('zzz')).toBe(false);
  });

  it('lookup returns a 300-dim normalized vector for a known word and null otherwise', () => {
    const dim = 300;
    const words = ['cat', 'cow'];
    const matrix = new Int8Array(words.length * dim);
    // give "cow" (row 1) a nonzero first component
    matrix[1 * dim + 0] = NUMBERBATCH_QUANT_SCALE;
    const idx = buildIndex(words);
    const v = lookup(idx, matrix, dim, 'cow');
    expect(v).not.toBeNull();
    expect(v!.length).toBe(300);
    expect(Math.hypot(...v!)).toBeCloseTo(1, 5);
    expect(lookup(idx, matrix, dim, 'nope')).toBeNull();
  });
});
