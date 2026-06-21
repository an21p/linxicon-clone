# Linxicon (recreation)

Bridge two unrelated words by adding intermediate words to a live graph. Words
auto-connect when their semantic similarity is at least 41%. Win by connecting the
two targets — using as few words as possible.

- Semantic similarity from an in-browser MiniLM model (`@huggingface/transformers`),
  run in a Web Worker. The model (~25MB) downloads once and is cached, so the game
  works offline afterward.
- Live force-directed graph via `d3-force` + Svelte/SVG.
- Infinite puzzles, no backend — ships as a static site.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # run the test suite
npm run check    # type-check (svelte-check + tsc)
npm run build    # static build to dist/
```

## How it works

- `src/lib/engine/` — pure-TypeScript game engine: holds the word graph, forms an edge
  between any two words whose cosine similarity is ≥ 0.41, and computes the "gap"
  between the two targets as the maximum-bottleneck (widest) path over all pairwise
  similarities. The targets are connected exactly when that gap reaches the threshold.
- `src/lib/embeddings.*` — MiniLM embeddings in a Web Worker, with an in-memory +
  IndexedDB cache (`src/lib/embedder.ts`).
- `src/lib/puzzles.ts` — picks two sufficiently-unrelated target words.
- `src/lib/game.ts` — Svelte store wiring everything together; persists stats
  (best score + streak) to localStorage (`src/lib/stats.ts`).
- `src/components/` — `Graph.svelte` (the live graph), `Hud.svelte`, `WinModal.svelte`.
