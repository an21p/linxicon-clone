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

  it('forms no edge when similarity is below the threshold to every word', () => {
    // 3D so a word can sit below threshold to BOTH targets at once
    // (impossible in 2D, where being far from A forces being near B).
    const a3 = { word: 'a', vector: [1, 0, 0] };
    const b3 = { word: 'b', vector: [0, 1, 0] };
    const e = new GameEngine(a3, b3);
    e.addWord('y', [0.4, 0.4, Math.sqrt(1 - 0.32)]); // sim(a,y)=sim(b,y)=0.40
    expect(e.getEdges()).toHaveLength(0);
  });

  it('throws when adding a duplicate word', () => {
    const e = new GameEngine(A, B);
    e.addWord('x', onAxis(0.5));
    expect(() => e.addWord('x', onAxis(0.5))).toThrow(/already/i);
    expect(() => e.addWord('a', [1, 0])).toThrow(/already/i);
  });
});
