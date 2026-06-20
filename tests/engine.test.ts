import { describe, it, expect } from 'vitest';
import { GameEngine, DEFAULT_THRESHOLD } from '../src/lib/engine/engine';

const A = { word: 'a', vector: [1, 0] };
const B = { word: 'b', vector: [0, 1] };          // sim(A,B) = 0
const onAxis = (sim: number) => [sim, Math.sqrt(1 - sim * sim)]; // sim with [1,0] == sim

describe('GameEngine edges', () => {
  it('uses 0.41 as the default threshold', () => {
    expect(DEFAULT_THRESHOLD).toBe(0.41);
  });

  it('forms no edge between far-apart targets at construction', () => {
    const e = new GameEngine(A, B);
    expect(e.getEdges()).toHaveLength(0);
  });

  it('forms an edge when similarity is exactly at the threshold', () => {
    const e = new GameEngine(A, B);
    e.addWord('x', onAxis(0.41)); // sim(A,x) = 0.41 exactly
    const edges = e.getEdges();
    expect(edges.some((ed) => (ed.a === 'a' && ed.b === 'x') || (ed.a === 'x' && ed.b === 'a'))).toBe(true);
  });

  it('forms no edge when similarity is just below the threshold', () => {
    const e = new GameEngine(A, B);
    e.addWord('y', onAxis(0.40)); // sim(A,y) = 0.40
    expect(e.getEdges()).toHaveLength(0);
  });

  it('throws when adding a duplicate word', () => {
    const e = new GameEngine(A, B);
    e.addWord('x', onAxis(0.5));
    expect(() => e.addWord('x', onAxis(0.5))).toThrow(/already/i);
    expect(() => e.addWord('a', [1, 0])).toThrow(/already/i);
  });
});
