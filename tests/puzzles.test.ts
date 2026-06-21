import { describe, it, expect } from 'vitest';
import { generatePuzzle } from '../src/lib/puzzles';
import { seededRng } from '../src/lib/seed';

const nouns = ['apple', 'banana', 'rocket', 'zebra', 'mountain', 'piano'];

describe('generatePuzzle', () => {
  it('returns two distinct words from the noun list', () => {
    const p = generatePuzzle({ nouns, rng: seededRng(20000, 0) });
    expect(p.a).not.toBe(p.b);
    expect(nouns).toContain(p.a);
    expect(nouns).toContain(p.b);
  });

  it('is deterministic for the same seed and varies by count', () => {
    const same1 = generatePuzzle({ nouns, rng: seededRng(20000, 0) });
    const same2 = generatePuzzle({ nouns, rng: seededRng(20000, 0) });
    expect(same1).toEqual(same2); // reload -> identical puzzle

    // advancing the count generally yields a different pair somewhere in the day
    const seeds = [0, 1, 2, 3, 4].map((c) => generatePuzzle({ nouns, rng: seededRng(20000, c) }));
    const unique = new Set(seeds.map((p) => `${p.a}|${p.b}`));
    expect(unique.size).toBeGreaterThan(1);
  });

  it('still produces distinct targets when both picks collide', () => {
    const p = generatePuzzle({ nouns, rng: () => 0 }); // always picks index 0
    expect(p.a).toBe('apple');
    expect(p.b).toBe('banana'); // (0 + 1) % len
  });
});
