# Linxicon Recreation — Design

**Date:** 2026-06-20
**Status:** Approved

## Overview

A browser-based word game inspired by [Linxicon](https://linxicon.com) (Trainwreck Labs).
The player is given two unrelated **target words** and must bridge them by adding
intermediate words to a **live force-directed graph**. An embedding model measures
semantic similarity between every pair of words on the board; any two words whose
similarity is at least the threshold (41%) are automatically connected by an edge. The
player wins when a connected path links the two target words. The score is the
**fewest words used** to build the bridge.

Differences from the original:
- **Infinite puzzles** — no once-a-day lock; a new puzzle can be generated anytime.
- No backend, no daily-reset infrastructure, no accounts.

## Stack

- **Svelte + Vite + TypeScript** — single-page app, static build, deployable anywhere.
- **`transformers.js`** running **all-MiniLM-L6-v2** for embeddings, executed in a
  **Web Worker** to keep the UI responsive. ~25MB model downloaded once, then cached
  in the browser (works offline afterward).
- **`d3-force`** (simulation only) for graph physics.
- **SVG rendering**, driven reactively by Svelte. Graphs are only tens of nodes, so
  SVG keeps node labels, highlighting, and the winning-path glow trivial to style.
  (Canvas is a later option if performance ever demands it.)
- **localStorage** for stats persistence.

## Modules

Each module has one clear purpose and a well-defined interface, and can be understood
and tested independently.

### `embeddings` service
- Lazy-loads MiniLM in a Web Worker.
- `embed(word): Promise<Float32Array>` — returns the word's embedding vector.
- `similarity(a, b): number` — cosine similarity between two vectors.
- In-memory + **IndexedDB** cache so repeated words are instant and the model is
  reused across sessions.
- Emits load progress for the UI.
- **Depends on:** transformers.js, IndexedDB.

### `dictionary`
- Bundled English word set used to reject gibberish.
- Normalizes input: lowercase, trim, single token only.
- `isValid(word): boolean`.
- **Depends on:** a bundled word list.

### `engine` (pure TypeScript, no DOM)
The core of the game. Fully testable with injected/mock vectors.
- State: `nodes` (word + vector), `edges` (pair + similarity), the two `targets`,
  connection threshold `T = 0.41` (configurable constant).
- `addWord(word, vector)` — computes similarity to all existing nodes, creates an
  edge for every pair with similarity ≥ T, and recomputes connectivity via
  **union-find**.
- `isSolved(): boolean` — true when the two targets are in the same connected
  component.
- `wordCount(): number` — number of intermediate words placed (the score).
- `closestGap(): number` — the weakest link along the best current path between the
  targets (or the direct similarity if no path yet), powering the "smallest gap %"
  readout.
- **Depends on:** nothing (pure).

### `puzzles` generator
- Curated list of concrete, common nouns.
- Picks two words at random whose similarity is **below a ceiling (~0.25)** so there
  is a real gap to bridge that is still solvable; rerolls if the pair is too close.
- **Depends on:** the `embeddings` service, a noun list.

### `Graph.svelte`
- Runs the d3-force simulation; binds node `x`/`y` reactively to SVG circles + labels.
- Edges spring into place when words connect; edge thickness/opacity ∝ similarity.
- Highlights: the two targets (distinct color, initially at opposite ends), the
  winning path (glow/pulse), the newest node (pop animation).
- Supports drag-to-reposition and zoom/pan.
- **Depends on:** d3-force, the `store`.

### `store` (Svelte store)
- Orchestrates `engine` + UI state: model-loading state, current input, win modal,
  current score, session best.
- Persists stats to localStorage.
- **Depends on:** `engine`, `embeddings`, `puzzles`, `dictionary`.

### `App.svelte` (shell / HUD)
- Displays the two target words, live word count, best score.
- Word input box, "New game" button, win modal, model-loading progress bar.
- **Depends on:** the `store`, `Graph.svelte`.

## Data Flow

1. Player types a word.
2. `store` validates via `dictionary` (recognized word, not a duplicate, not already
   on the board).
3. The word is embedded in the Web Worker (cache hit returns instantly).
4. `engine.addWord` adds the node, creates all edges ≥ T, recomputes connectivity and
   `closestGap`.
5. `store` updates; `Graph.svelte` reactively animates the new node and its edges.
6. If `engine.isSolved()`: glow the winning path, show the win modal with the word
   count, and update the best score.

## Error & Edge Handling

- **Model still loading:** input disabled, progress bar shown.
- **Unknown word** (not in dictionary): inline error, "not a recognized word."
- **Duplicate / already on board:** inline notice.
- **Offline before first model load:** clear message; the game works offline once the
  model has been cached.
- **Puzzle generator can't find a good pair:** retry with a fallback list.

## Scoring & Persistence

- **Score** = number of intermediate words used when the puzzle is solved (lower is
  better).
- **localStorage** tracks: games played, games won, best (lowest) word count, and
  current streak.

## Testing

- **`engine`** (TDD): edge formation at the threshold boundary, connectivity
  detection, word-count scoring, and `closestGap` math — all with mock vectors.
- **`embeddings`**: cosine similarity against known vectors; cache-hit behavior.
- **`dictionary`**: validation rules (normalization, rejection of gibberish).
- **Integration**: one add-word → connect flow test with a stubbed embedding service.

## Configurable Constants

- Connection threshold `T = 0.41`.
- Target-pair similarity ceiling (~0.25).
- Model name (all-MiniLM-L6-v2).
