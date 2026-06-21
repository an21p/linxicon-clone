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

describe('GameEngine connectivity', () => {
  const A = { word: 'a', vector: [1, 0] };
  const B = { word: 'b', vector: [0, 1] };
  const mid = [1, 1]; // sim with A and with B both = 0.7071...

  it('closestGap equals direct similarity with only targets present', () => {
    const e = new GameEngine(A, B);
    expect(e.closestGap()).toBeCloseTo(0, 6); // sim(A,B) = 0
    expect(e.isSolved()).toBe(false);
  });

  it('bridges the targets through a middle word', () => {
    const e = new GameEngine(A, B);
    e.addWord('mid', mid);
    expect(e.closestGap()).toBeCloseTo(Math.SQRT1_2, 6); // min(0.707, 0.707)
    expect(e.isSolved()).toBe(true);
  });

  it('is not solved when the bridge link is below threshold', () => {
    const e = new GameEngine(A, B);
    e.addWord('weak', [0.39, Math.sqrt(1 - 0.39 ** 2)]); // sim(A,weak)=0.39, sim(B,weak)<threshold
    expect(e.isSolved()).toBe(false);
  });

  it('bridgePath is just the two targets when no words are placed', () => {
    const e = new GameEngine(A, B);
    expect(e.bridgePath()).toEqual(['a', 'b']);
  });

  it('bridgePath threads from A through the middle word to B', () => {
    const e = new GameEngine(A, B);
    e.addWord('mid', mid);
    expect(e.bridgePath()).toEqual(['a', 'mid', 'b']);
  });

  it('bridgePath picks the widest chain when several exist', () => {
    // 'near' bridges both targets strongly; 'far' only weakly. The widest
    // (max-bottleneck) path should route through 'near'.
    const e = new GameEngine(A, B);
    e.addWord('near', [1, 1]);                              // sim ~0.707 to each
    e.addWord('far', [0.42, Math.sqrt(1 - 0.42 ** 2)]);    // weaker bottleneck
    const path = e.bridgePath();
    expect(path[0]).toBe('a');
    expect(path[path.length - 1]).toBe('b');
    expect(path).toContain('near');
    expect(path).not.toContain('far');
  });
});

describe('GameEngine scoring', () => {
  const A = { word: 'a', vector: [1, 0] };
  const B = { word: 'b', vector: [0, 1] };

  it('counts only intermediate words, not the two targets', () => {
    const e = new GameEngine(A, B);
    expect(e.wordCount()).toBe(0);
    e.addWord('one', [1, 1]);
    e.addWord('two', [1, 2]);
    expect(e.wordCount()).toBe(2);
  });
});
