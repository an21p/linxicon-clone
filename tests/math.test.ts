import { describe, it, expect } from 'vitest';
import { cosineSimilarity } from '../src/lib/math';

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1, 6);
  });
  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });
  it('is scale-invariant', () => {
    expect(cosineSimilarity([1, 1], [3, 3])).toBeCloseTo(1, 6);
  });
  it('returns the cosine of the angle', () => {
    expect(cosineSimilarity([1, 0], [0.41, Math.sqrt(1 - 0.41 ** 2)])).toBeCloseTo(0.41, 6);
  });
  it('returns 0 when a vector is all zeros', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});
