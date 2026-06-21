import { NOUNS } from './words/nouns';

export interface Puzzle {
  a: string;
  b: string;
}

export interface PuzzleOptions {
  nouns?: string[];
  rng?: () => number; // injectable; seed it for a deterministic daily puzzle
}

/**
 * Pick two distinct target nouns from `rng` alone — independent of any embedding
 * model, so the same seed yields the same puzzle under every model and across reloads.
 */
export function generatePuzzle(opts: PuzzleOptions = {}): Puzzle {
  const nouns = opts.nouns ?? NOUNS;
  const rng = opts.rng ?? Math.random;
  if (nouns.length < 2) throw new Error('need at least two nouns to make a puzzle');

  const i = Math.floor(rng() * nouns.length);
  let j = Math.floor(rng() * nouns.length);
  if (j === i) j = (i + 1) % nouns.length; // guarantee distinct targets
  return { a: nouns[i], b: nouns[j] };
}
