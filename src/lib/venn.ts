import type { Edge } from './engine/types';

/**
 * Force-link target distance for two word circles, encoding similarity as overlap.
 *
 * At `sim <= threshold` the circles merely touch (distance = radiusA + radiusB).
 * As `sim` rises toward 1 they overlap more deeply, but the distance never drops
 * below the larger radius — so the smaller circle's centre stays outside the larger
 * one and neither is ever fully absorbed.
 */
export function overlapDistance(
  radiusA: number,
  radiusB: number,
  sim: number,
  threshold: number,
): number {
  const touching = radiusA + radiusB;
  const floor = Math.max(radiusA, radiusB);
  // Fraction of the way from threshold (0) to perfect similarity (1).
  const span = Math.max(1e-6, 1 - threshold);
  const t = Math.min(1, Math.max(0, (sim - threshold) / span));
  return touching - t * (touching - floor);
}

/** Edges sorted by similarity descending, without mutating the input (stable). */
export function sortedLinks(edges: Edge[]): Edge[] {
  return edges
    .map((e, i) => ({ e, i }))
    .sort((x, y) => y.e.sim - x.e.sim || x.i - y.i)
    .map(({ e }) => e);
}
