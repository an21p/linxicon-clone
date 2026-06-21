# Venn (Euler cloud) view + links panel — design

**Date:** 2026-06-21

## Goal

Add a second way to read the same Linxicon board: an **Euler cloud** where every
word is a translucent circle and connected words visibly overlap (overlap depth ∝
similarity). Add a **links panel** down the left of the board — a live list of every
connected word pair with its similarity % — shown on **both** the existing graph view
and the new Venn view. The two views share one live game.

## Decisions (from brainstorming)

- **Venn metaphor:** Euler cloud — every word is a circle; circles overlap when
  `sim ≥ threshold`, overlap depth scales with similarity. Same game, alternate render.
- **Left panel:** the connected pairs (edges), sorted highest-similarity first, with %.
- **Navigation:** a `Graph | Venn` toggle in the HUD bar. Both views render the SAME
  live game (same puzzle, same words). The active view is reflected in `?view=`.

## Architecture

Single-page Vite + Svelte app, no router, no backend changes. One game engine instance
in `App.svelte`; the view toggle only swaps which board component renders `$state`.

### `App.svelte` (owns view state)
- `view: 'graph' | 'venn'`, initialized from the `?view=` URL param, persisted back via
  `history.replaceState` (mirrors the existing `?puzzle=` handling in `seed.ts`).
- `.canvas` becomes a two-column row: `LinksPanel` (fixed left) + board (right). The
  board is `Graph.svelte` when `view==='graph'`, else `VennBoard.svelte`.
- On ≤640px the panel drops below the board.

### `Hud.svelte`
- Adds a `view` prop and a `Graph | Venn` segmented control in the top `.bar`,
  dispatching a `view` event up to `App`.

### `LinksPanel.svelte` (new — used by both views)
- Props: `edges`, `targetA`, `targetB`. Single purpose: list connected pairs.
- Renders `sortedLinks(edges)` as `a ~ b   0.71` rows with a small per-row strength bar.
  Rows touching a target get a gold accent. Header shows `LINKS · N`. Empty state when
  no edges yet.

### `VennBoard.svelte` (new — the Euler cloud)
- Same d3-force skeleton, gradients, vignette, frame-clamp, and drag as `Graph.svelte`
  so it feels like the same atlas, but each word renders as a translucent filled circle
  with a centered label instead of a star.
- Connected pairs get a `forceLink` whose target distance comes from `overlapDistance`,
  so circles overlap more as `sim` rises (just-touching at `sim = threshold`, deep
  overlap near `sim = 1`). Unconnected pairs are pushed apart by charge → no overlap.
- Targets are larger gold circles; intermediates starlight-blue. Last-added word keeps
  the "ignite" pop animation.

### `src/lib/venn.ts` (new — pure logic, unit-tested)
- `overlapDistance(radiusA, radiusB, sim, threshold)` → force-link target distance
  (the sim→overlap mapping). At `sim ≤ threshold` returns ≈ `radiusA + radiusB`
  (touching); approaches a small fraction of that as `sim → 1` (deep overlap).
- `sortedLinks(edges)` → edges sorted by `sim` descending, stable.

## Data flow

`engine.getEdges()` already returns every pair with `sim ≥ threshold`. Both the panel
and the Venn overlaps consume that same `$state.edges` array — no new similarity
computation.

## Error handling

No new failure modes. Empty board → panel shows its empty state; Venn shows just the two
target circles. Same loading/fatal-error path as today.

## Testing

- `tests/venn.test.ts` (vitest): `overlapDistance` monotonicity + boundary behavior
  (touching at threshold, deeper as sim rises) and `sortedLinks` ordering/stability.
- Force-layout rendering is verified live in the browser (no DOM physics in unit tests).

## Out of scope (YAGNI)

No router library, no separate game instances per view, no new similarity metric, no
n-way true-Venn region math — translucent overlapping circles, not labeled intersections.
