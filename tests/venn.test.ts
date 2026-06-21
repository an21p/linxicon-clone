import { describe, it, expect } from 'vitest';
import { overlapDistance, sortedLinks } from '../src/lib/venn';
import type { Edge } from '../src/lib/engine/types';

const THRESHOLD = 0.41;

describe('overlapDistance', () => {
  it('is ~touching (radiusA + radiusB) at or below the threshold', () => {
    const sum = 20 + 30;
    expect(overlapDistance(20, 30, THRESHOLD, THRESHOLD)).toBeCloseTo(sum, 5);
    // below threshold clamps to touching, never further apart
    expect(overlapDistance(20, 30, 0.1, THRESHOLD)).toBeCloseTo(sum, 5);
  });

  it('shrinks monotonically as similarity rises (deeper overlap)', () => {
    const at = (s: number) => overlapDistance(20, 30, s, THRESHOLD);
    const a = at(0.5), b = at(0.7), c = at(0.9), d = at(1);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
    expect(c).toBeGreaterThan(d);
  });

  it('never collapses below the larger radius (circles never fully absorb)', () => {
    expect(overlapDistance(20, 30, 1, THRESHOLD)).toBeGreaterThanOrEqual(30);
  });

  it('stays within [largerRadius, radiusA + radiusB] across the whole range', () => {
    const lo = 30, hi = 50;
    for (const s of [0.41, 0.5, 0.6, 0.75, 0.9, 1]) {
      const d = overlapDistance(20, 30, s, THRESHOLD);
      expect(d).toBeGreaterThanOrEqual(lo);
      expect(d).toBeLessThanOrEqual(hi);
    }
  });
});

describe('sortedLinks', () => {
  it('sorts edges by similarity descending', () => {
    const edges: Edge[] = [
      { a: 'a', b: 'b', sim: 0.4 },
      { a: 'c', b: 'd', sim: 0.9 },
      { a: 'e', b: 'f', sim: 0.6 },
    ];
    expect(sortedLinks(edges).map((e) => e.sim)).toEqual([0.9, 0.6, 0.4]);
  });

  it('does not mutate the input array', () => {
    const edges: Edge[] = [
      { a: 'a', b: 'b', sim: 0.4 },
      { a: 'c', b: 'd', sim: 0.9 },
    ];
    sortedLinks(edges);
    expect(edges.map((e) => e.sim)).toEqual([0.4, 0.9]);
  });

  it('is stable for equal similarities (preserves input order)', () => {
    const edges: Edge[] = [
      { a: 'x', b: 'y', sim: 0.5 },
      { a: 'p', b: 'q', sim: 0.5 },
    ];
    expect(sortedLinks(edges).map((e) => e.a)).toEqual(['x', 'p']);
  });
});
