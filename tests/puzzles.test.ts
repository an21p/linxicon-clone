import { describe, it, expect } from 'vitest';
import { generatePuzzle } from '../src/lib/puzzles';
import { withCache } from '../src/lib/embedder';

// Deterministic fake: each word maps to a fixed 2D vector by first letter code.
const fakeEmbedder = withCache(async (w: string) => {
  const angle = (w.charCodeAt(0) % 16) * (Math.PI / 16);
  return new Float32Array([Math.cos(angle), Math.sin(angle)]);
});

describe('generatePuzzle', () => {
  it('returns two distinct words below the similarity ceiling', async () => {
    const nouns = ['apple', 'banana', 'rocket', 'zebra', 'mountain', 'piano'];
    let i = 0;
    const rng = () => [0.05, 0.5, 0.95, 0.2, 0.8, 0.35][i++ % 6]; // deterministic
    const p = await generatePuzzle(fakeEmbedder, { nouns, ceiling: 0.25, rng });
    expect(p.a).not.toBe(p.b);
    expect(p.simAB).toBeLessThan(0.25);
    expect(nouns).toContain(p.a);
    expect(nouns).toContain(p.b);
  });
});
