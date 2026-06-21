// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { VectorTable, QUANT_SCALE } from '../../server/vectorTable';

describe('VectorTable', () => {
  it('lookup returns a unit-norm Float32Array of the table dim for a known word', () => {
    const dim = 3;
    const words = ['cat', 'cow'];
    const matrix = new Int8Array(words.length * dim);
    matrix[1 * dim + 0] = QUANT_SCALE; // cow -> [1,0,0] after normalize
    const t = new VectorTable(matrix, words, dim);
    const v = t.lookup('cow');
    expect(v).not.toBeNull();
    expect(v!.length).toBe(3);
    expect(Math.hypot(...v!)).toBeCloseTo(1, 5);
    expect(v![0]).toBeCloseTo(1, 5);
  });

  it('lookup returns null for an unknown word', () => {
    const t = new VectorTable(new Int8Array(3), ['cat'], 3);
    expect(t.lookup('zzz')).toBeNull();
  });
});
