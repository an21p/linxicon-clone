import type { Embedder } from './embedder';
import { cosineSimilarity } from './math';
import { NOUNS } from './words/nouns';

export interface Puzzle {
  a: string;
  b: string;
  simAB: number;
}

export interface PuzzleOptions {
  nouns?: string[];
  ceiling?: number;       // max allowed sim between the two targets
  rng?: () => number;     // injectable for tests
  maxTries?: number;
}

export async function generatePuzzle(
  embedder: Embedder,
  opts: PuzzleOptions = {},
): Promise<Puzzle> {
  const nouns = opts.nouns ?? NOUNS;
  const ceiling = opts.ceiling ?? 0.25;
  const rng = opts.rng ?? Math.random;
  const maxTries = opts.maxTries ?? 50;

  const pick = () => nouns[Math.floor(rng() * nouns.length)];

  let fallback: Puzzle | null = null;
  for (let t = 0; t < maxTries; t++) {
    const a = pick();
    let b = pick();
    if (a === b) continue;
    const [va, vb] = await Promise.all([embedder.embed(a), embedder.embed(b)]);
    const simAB = cosineSimilarity(va, vb);
    const candidate: Puzzle = { a, b, simAB };
    if (simAB < ceiling) return candidate;
    if (!fallback || simAB < fallback.simAB) fallback = candidate;
  }
  if (!fallback) throw new Error('could not generate a puzzle');
  return fallback; // best (lowest-sim) pair we found
}
