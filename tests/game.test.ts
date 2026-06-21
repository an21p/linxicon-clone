import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { createGame } from '../src/lib/game';
import { withCache } from '../src/lib/embedder';

// fixed vectors for a tiny world
const VEC: Record<string, number[]> = {
  alpha: [1, 0],
  omega: [0, 1],
  mid: [1, 1],     // bridges alpha & omega
  junk: [0.39, Math.sqrt(1 - 0.39 ** 2)],
};
const embedder = withCache(async (w: string) => new Float32Array(VEC[w] ?? [1, 0]));
const validateWord = (w: string) =>
  VEC[w.toLowerCase()]
    ? ({ ok: true, word: w.toLowerCase() } as const)
    : ({ ok: false, reason: 'unknown' } as const);
const generatePuzzle = () => ({ a: 'alpha', b: 'omega' });

beforeEach(() => localStorage.clear());

describe('createGame', () => {
  it('starts a puzzle with the two targets on the board', async () => {
    const game = createGame({ embedder, validateWord, generatePuzzle });
    await game.newGame();
    const s = get(game.state);
    expect(s.nodes.map((n) => n.id).sort()).toEqual(['alpha', 'omega']);
    expect(s.solved).toBe(false);
    expect(s.wordCount).toBe(0);
  });

  it('rejects an unknown word without adding a node', async () => {
    const game = createGame({ embedder, validateWord, generatePuzzle });
    await game.newGame();
    const res = await game.submitWord('zzzz');
    expect(res.ok).toBe(false);
    expect(get(game.state).nodes).toHaveLength(2);
  });

  it('rejects a duplicate word', async () => {
    const game = createGame({ embedder, validateWord, generatePuzzle });
    await game.newGame();
    const res = await game.submitWord('alpha');
    expect(res.ok).toBe(false);
    expect(get(game.state).nodes).toHaveLength(2);
  });

  it('wins when a bridging word connects the targets and records best score', async () => {
    const game = createGame({ embedder, validateWord, generatePuzzle });
    await game.newGame();
    await game.submitWord('mid');
    const s = get(game.state);
    expect(s.solved).toBe(true);
    expect(s.wordCount).toBe(1);
    expect(get(game.stats).best).toBe(1);
  });

  it('does not win when the added word is below threshold to both', async () => {
    const game = createGame({ embedder, validateWord, generatePuzzle });
    await game.newGame();
    await game.submitWord('junk');
    expect(get(game.state).solved).toBe(false);
  });

  it('re-embeds the live graph when the embedder is swapped', async () => {
    const game = createGame({ embedder, validateWord, generatePuzzle });
    await game.newGame();
    await game.submitWord('mid');               // 3 nodes: alpha, omega, mid
    expect(get(game.state).wordCount).toBe(1);

    // New backend: same words, different vectors (mid no longer bridges).
    const ALT: Record<string, number[]> = {
      alpha: [1, 0], omega: [0, 1], mid: [1, 0.001],
    };
    const alt = withCache(async (w: string) => new Float32Array(ALT[w] ?? [1, 0]));
    game.setEmbedder(alt);
    await game.reEmbedCurrent();

    const s = get(game.state);
    expect(s.nodes.map((n) => n.id).sort()).toEqual(['alpha', 'mid', 'omega']);
    expect(s.wordCount).toBe(1);                // same words preserved
    expect(s.solved).toBe(false);               // re-scored under the new backend
  });
});
