# Linxicon Recreation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser word game where the player bridges two unrelated target words by adding intermediate words to a live force-directed graph; words auto-connect when their semantic similarity is ≥ 41%, and the player wins by connecting the two targets using as few words as possible.

**Architecture:** A pure-TypeScript game engine (no DOM) holds the word graph and computes connectivity via a maximum-bottleneck "widest path" over all pairwise cosine similarities. Embeddings come from an in-browser MiniLM model (`@huggingface/transformers`) run in a Web Worker. A Svelte store orchestrates engine + embeddings + puzzle generation, and Svelte components render a `d3-force` simulation to SVG. No backend; ships as a static site.

**Tech Stack:** Svelte + Vite + TypeScript, Vitest (jsdom) for tests, `@huggingface/transformers` (all-MiniLM-L6-v2), `d3-force`, `idb-keyval`, SVG rendering, localStorage for stats.

---

## File Structure

```
src/
  lib/
    math.ts              # cosineSimilarity
    engine/
      types.ts           # WordNode, Edge, AddResult
      engine.ts          # GameEngine: addWord, getEdges, closestGap, isSolved, wordCount
    dictionary.ts        # word validation/normalization + bundled word set
    words/
      dictionary.json    # bundled valid-word set (large)
      nouns.ts           # curated target-noun list
    embedder.ts          # withCache(embedFn, store?) -> Embedder
    embeddings.worker.ts # transformers.js feature-extraction in a worker
    embeddings.ts        # worker-backed embedFn + Embedder wiring
    puzzles.ts           # generatePuzzle(embedder, opts)
    stats.ts             # load/save stats to localStorage
    game.ts              # createGame({embedder, validateWord, generatePuzzle}) Svelte store
  components/
    Graph.svelte         # d3-force simulation rendered to SVG
    Hud.svelte           # targets, word count, best score, input
    WinModal.svelte      # win summary + play again
  App.svelte             # shell: loading -> game, wires store to components
  main.ts                # mount
tests/
  math.test.ts
  engine.test.ts
  dictionary.test.ts
  embedder.test.ts
  puzzles.test.ts
  game.test.ts
```

---

## Task 1: Project scaffold

**Files:**
- Create: whole project under `/Users/pishias/linxicon-clone`
- Modify: `package.json`, `vite.config.ts`, `tsconfig.json`

- [ ] **Step 1: Scaffold Vite + Svelte + TS**

Run from `/Users/pishias/linxicon-clone`:

```bash
npm create vite@latest . -- --template svelte-ts
npm install
npm install d3-force idb-keyval @huggingface/transformers
npm install -D vitest jsdom @types/d3-force
```

If `npm create vite` refuses because the directory is non-empty, run it in a temp dir and copy files in, preserving the existing `docs/` and `.git/`.

- [ ] **Step 2: Configure Vitest**

Create `vite.config.ts` (replace generated one):

```ts
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
  worker: { format: 'es' },
});
```

Add scripts to `package.json`:

```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 3: Verify toolchain**

Run: `npm run dev` — Expected: dev server starts at `http://localhost:5173` with the default Svelte page. Stop it (Ctrl-C).
Run: `npx vitest run` — Expected: "No test files found" (exit 0) or passes with 0 tests.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: scaffold Svelte + Vite + Vitest project"
```

---

## Task 2: Cosine similarity utility

**Files:**
- Create: `src/lib/math.ts`
- Test: `tests/math.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/math.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { cosineSimilarity } from '../src/lib/math';

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1, 6);
  });
  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });
  it('is scale-invariant', () => {
    expect(cosineSimilarity([1, 1], [3, 3])).toBeCloseTo(1, 6);
  });
  it('returns the cosine of the angle', () => {
    // [1,0] vs [0.41, sqrt(1-0.41^2)] -> cos = 0.41
    expect(cosineSimilarity([1, 0], [0.41, Math.sqrt(1 - 0.41 ** 2)])).toBeCloseTo(0.41, 6);
  });
  it('returns 0 when a vector is all zeros', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/math.test.ts`
Expected: FAIL — cannot find module `../src/lib/math`.

- [ ] **Step 3: Implement**

`src/lib/math.ts`:

```ts
export type Vec = number[] | Float32Array;

export function cosineSimilarity(a: Vec, b: Vec): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/math.test.ts` — Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/math.ts tests/math.test.ts
git commit -m "feat: add cosineSimilarity utility"
```

---

## Task 3: Engine — types, addWord, edges

**Files:**
- Create: `src/lib/engine/types.ts`, `src/lib/engine/engine.ts`
- Test: `tests/engine.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/engine.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { GameEngine, DEFAULT_THRESHOLD } from '../src/lib/engine/engine';

// 2D unit-ish vectors give known cosine sims with [1,0].
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine.test.ts`
Expected: FAIL — cannot find module `engine`.

- [ ] **Step 3: Implement types**

`src/lib/engine/types.ts`:

```ts
import type { Vec } from '../math';

export interface WordNode {
  id: string;       // normalized word
  vector: Vec;
  isTarget: boolean;
}

export interface Edge {
  a: string;        // word id
  b: string;        // word id
  sim: number;      // cosine similarity (>= threshold)
}

export interface WordSeed {
  word: string;
  vector: Vec;
}
```

- [ ] **Step 4: Implement engine (edges only for now)**

`src/lib/engine/engine.ts`:

```ts
import { cosineSimilarity, type Vec } from '../math';
import type { WordNode, Edge, WordSeed } from './types';

export const DEFAULT_THRESHOLD = 0.41;

export class GameEngine {
  readonly threshold: number;
  readonly targetA: string;
  readonly targetB: string;
  private nodes = new Map<string, WordNode>();
  private edges: Edge[] = [];

  constructor(a: WordSeed, b: WordSeed, threshold: number = DEFAULT_THRESHOLD) {
    this.threshold = threshold;
    this.targetA = a.word;
    this.targetB = b.word;
    this.insert(a.word, a.vector, true);
    this.insert(b.word, b.vector, true);
  }

  private insert(word: string, vector: Vec, isTarget: boolean): WordNode {
    if (this.nodes.has(word)) {
      throw new Error(`"${word}" is already on the board`);
    }
    const node: WordNode = { id: word, vector, isTarget };
    for (const existing of this.nodes.values()) {
      const sim = cosineSimilarity(vector, existing.vector);
      if (sim >= this.threshold) {
        this.edges.push({ a: word, b: existing.id, sim });
      }
    }
    this.nodes.set(word, node);
    return node;
  }

  addWord(word: string, vector: Vec): WordNode {
    return this.insert(word, vector, false);
  }

  getEdges(): Edge[] {
    return this.edges.map((e) => ({ ...e }));
  }

  getNodes(): WordNode[] {
    return [...this.nodes.values()].map((n) => ({ ...n }));
  }

  has(word: string): boolean {
    return this.nodes.has(word);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/engine.test.ts` — Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/engine tests/engine.test.ts
git commit -m "feat: add game engine with edge formation at 41% threshold"
```

---

## Task 4: Engine — closestGap & isSolved (widest path)

The "gap" between the two targets is the **maximum-bottleneck path**: over all paths through the complete graph of pairwise similarities, the path whose weakest link is largest. `isSolved` is true exactly when that bottleneck ≥ threshold (every edge on the best path qualifies). With only the two targets present, the gap equals their direct similarity.

**Files:**
- Modify: `src/lib/engine/engine.ts`
- Test: `tests/engine.test.ts` (add cases)

- [ ] **Step 1: Add failing tests**

Append to `tests/engine.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/engine.test.ts`
Expected: FAIL — `e.closestGap is not a function`.

- [ ] **Step 3: Implement widest path**

Add these methods to the `GameEngine` class in `src/lib/engine/engine.ts`:

```ts
  /** Maximum-bottleneck similarity along the best path between the two targets. */
  closestGap(): number {
    const ids = [...this.nodes.keys()];
    const best = new Map<string, number>();
    for (const id of ids) best.set(id, -Infinity);
    best.set(this.targetA, Infinity);
    const visited = new Set<string>();

    while (visited.size < ids.length) {
      let u: string | null = null;
      let bu = -Infinity;
      for (const id of ids) {
        const v = best.get(id)!;
        if (!visited.has(id) && v > bu) { bu = v; u = id; }
      }
      if (u === null) break;
      visited.add(u);
      if (u === this.targetB) break;

      const uVec = this.nodes.get(u)!.vector;
      for (const v of ids) {
        if (visited.has(v)) continue;
        const w = cosineSimilarity(uVec, this.nodes.get(v)!.vector);
        const cand = Math.min(best.get(u)!, w);
        if (cand > best.get(v)!) best.set(v, cand);
      }
    }
    const gap = best.get(this.targetB)!;
    return gap === Infinity ? 1 : gap;
  }

  isSolved(): boolean {
    return this.closestGap() >= this.threshold;
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/engine.test.ts` — Expected: PASS (all engine tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/engine.ts tests/engine.test.ts
git commit -m "feat: add widest-path closestGap and isSolved to engine"
```

---

## Task 5: Engine — wordCount (score)

**Files:**
- Modify: `src/lib/engine/engine.ts`
- Test: `tests/engine.test.ts` (add cases)

- [ ] **Step 1: Add failing test**

Append to `tests/engine.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/engine.test.ts` — Expected: FAIL — `e.wordCount is not a function`.

- [ ] **Step 3: Implement**

Add to `GameEngine`:

```ts
  /** Number of intermediate words placed (excludes the two targets). */
  wordCount(): number {
    return this.nodes.size - 2;
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/engine.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/engine.ts tests/engine.test.ts
git commit -m "feat: add wordCount scoring to engine"
```

---

## Task 6: Dictionary validation

**Files:**
- Create: `src/lib/dictionary.ts`, `src/lib/words/dictionary.json`
- Test: `tests/dictionary.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/dictionary.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeWord, makeValidator } from '../src/lib/dictionary';

const words = new Set(['cow', 'milk', 'cat']);
const isValid = makeValidator(words);

describe('normalizeWord', () => {
  it('lowercases and trims', () => {
    expect(normalizeWord('  Cow  ')).toBe('cow');
  });
  it('returns null for multi-token input', () => {
    expect(normalizeWord('dairy cow')).toBeNull();
  });
  it('returns null for empty input', () => {
    expect(normalizeWord('   ')).toBeNull();
  });
});

describe('makeValidator', () => {
  it('accepts a recognized word', () => {
    expect(isValid('Milk')).toEqual({ ok: true, word: 'milk' });
  });
  it('rejects gibberish', () => {
    expect(isValid('asdfgh')).toEqual({ ok: false, reason: 'unknown' });
  });
  it('rejects malformed input', () => {
    expect(isValid('two words')).toEqual({ ok: false, reason: 'malformed' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/dictionary.test.ts` — Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

`src/lib/dictionary.ts`:

```ts
export function normalizeWord(raw: string): string | null {
  const w = raw.trim().toLowerCase();
  if (w.length === 0) return null;
  if (!/^[a-z]+(?:[-'][a-z]+)*$/.test(w)) return null; // single token, letters/hyphen/apostrophe
  return w;
}

export type ValidationResult =
  | { ok: true; word: string }
  | { ok: false; reason: 'malformed' | 'unknown' };

export function makeValidator(words: Set<string>) {
  return (raw: string): ValidationResult => {
    const w = normalizeWord(raw);
    if (w === null) return { ok: false, reason: 'malformed' };
    if (!words.has(w)) return { ok: false, reason: 'unknown' };
    return { ok: true, word: w };
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/dictionary.test.ts` — Expected: PASS (6 tests).

- [ ] **Step 5: Add the real word list**

Create `src/lib/words/dictionary.json` as a JSON array of valid English words. Source a permissive list (e.g. the `dwyl/english-words` `words_alpha.txt`, ~370k words) and convert to lowercase JSON array. Add a loader at the bottom of `src/lib/dictionary.ts`:

```ts
import rawWords from './words/dictionary.json';

export const DICTIONARY = new Set<string>(rawWords as string[]);
export const validateWord = makeValidator(DICTIONARY);
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/dictionary.ts src/lib/words/dictionary.json tests/dictionary.test.ts
git commit -m "feat: add dictionary normalization and validation"
```

---

## Task 7: Embedder cache wrapper

The cache wrapper is pure and testable; the heavyweight model lives behind an injected `embedFn` (Task 8 wires the worker in).

**Files:**
- Create: `src/lib/embedder.ts`
- Test: `tests/embedder.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/embedder.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { withCache } from '../src/lib/embedder';

describe('withCache', () => {
  it('calls the underlying embedFn once per unique word', async () => {
    const fn = vi.fn(async (w: string) => new Float32Array([w.length]));
    const e = withCache(fn);
    await e.embed('cow');
    await e.embed('cow');
    await e.embed('milk');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('normalizes case before caching', async () => {
    const fn = vi.fn(async () => new Float32Array([1]));
    const e = withCache(fn);
    await e.embed('Cow');
    await e.embed('cow');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('reads from a persistent store before calling embedFn', async () => {
    const fn = vi.fn(async () => new Float32Array([9]));
    const store = {
      get: vi.fn(async () => new Float32Array([7])),
      set: vi.fn(async () => {}),
    };
    const e = withCache(fn, store);
    const v = await e.embed('cat');
    expect(Array.from(v)).toEqual([7]);
    expect(fn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/embedder.test.ts` — Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

`src/lib/embedder.ts`:

```ts
export interface Embedder {
  embed(word: string): Promise<Float32Array>;
}

export interface PersistentStore {
  get(key: string): Promise<Float32Array | undefined>;
  set(key: string, value: Float32Array): Promise<void>;
}

export function withCache(
  embedFn: (word: string) => Promise<Float32Array>,
  store?: PersistentStore,
): Embedder {
  const mem = new Map<string, Float32Array>();
  return {
    async embed(word: string): Promise<Float32Array> {
      const key = word.trim().toLowerCase();
      const hit = mem.get(key);
      if (hit) return hit;

      if (store) {
        const persisted = await store.get(key);
        if (persisted) { mem.set(key, persisted); return persisted; }
      }

      const v = await embedFn(key);
      mem.set(key, v);
      if (store) await store.set(key, v);
      return v;
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/embedder.test.ts` — Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/embedder.ts tests/embedder.test.ts
git commit -m "feat: add in-memory + persistent embedding cache"
```

---

## Task 8: Embeddings worker + wiring

No unit test (requires the real model + browser). Verified manually in Task 12.

**Files:**
- Create: `src/lib/embeddings.worker.ts`, `src/lib/embeddings.ts`

- [ ] **Step 1: Implement the worker**

`src/lib/embeddings.worker.ts`:

```ts
import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers';

env.allowLocalModels = false; // fetch from the HF hub / CDN

let extractor: FeatureExtractionPipeline | null = null;

async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractor) {
    extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      progress_callback: (p: any) => {
        if (p?.status === 'progress') {
          self.postMessage({ type: 'progress', progress: p.progress ?? 0 });
        }
      },
    });
    self.postMessage({ type: 'ready' });
  }
  return extractor;
}

self.onmessage = async (ev: MessageEvent) => {
  const { id, word } = ev.data as { id: number; word: string };
  try {
    const ex = await getExtractor();
    const output = await ex(word, { pooling: 'mean', normalize: true });
    const vector = Float32Array.from(output.data as Float32Array);
    self.postMessage({ type: 'result', id, vector }, [vector.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', id, message: String(err) });
  }
};

// Kick off model load eagerly so progress starts immediately.
getExtractor();
```

- [ ] **Step 2: Implement the main-thread wiring**

`src/lib/embeddings.ts`:

```ts
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { withCache, type Embedder, type PersistentStore } from './embedder';

export interface EmbeddingsHandle {
  embedder: Embedder;
  onProgress(cb: (progress: number) => void): void;
  onReady(cb: () => void): void;
}

export function createEmbeddings(): EmbeddingsHandle {
  const worker = new Worker(new URL('./embeddings.worker.ts', import.meta.url), { type: 'module' });

  let nextId = 1;
  const pending = new Map<number, { resolve: (v: Float32Array) => void; reject: (e: Error) => void }>();
  let progressCb: ((p: number) => void) | null = null;
  let readyCb: (() => void) | null = null;

  worker.onmessage = (ev: MessageEvent) => {
    const msg = ev.data;
    if (msg.type === 'result') {
      pending.get(msg.id)?.resolve(msg.vector);
      pending.delete(msg.id);
    } else if (msg.type === 'error') {
      pending.get(msg.id)?.reject(new Error(msg.message));
      pending.delete(msg.id);
    } else if (msg.type === 'progress') {
      progressCb?.(msg.progress);
    } else if (msg.type === 'ready') {
      readyCb?.();
    }
  };

  const embedFn = (word: string) =>
    new Promise<Float32Array>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, word });
    });

  const store: PersistentStore = {
    async get(key) { return (await idbGet(`vec:${key}`)) as Float32Array | undefined; },
    async set(key, value) { await idbSet(`vec:${key}`, value); },
  };

  return {
    embedder: withCache(embedFn, store),
    onProgress(cb) { progressCb = cb; },
    onReady(cb) { readyCb = cb; },
  };
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit` — Expected: no errors. (Fix any import/type mismatches against the installed `@huggingface/transformers` version.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/embeddings.worker.ts src/lib/embeddings.ts
git commit -m "feat: add MiniLM embeddings worker and main-thread wiring"
```

---

## Task 9: Puzzle generator

**Files:**
- Create: `src/lib/words/nouns.ts`, `src/lib/puzzles.ts`
- Test: `tests/puzzles.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/puzzles.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generatePuzzle } from '../src/lib/puzzles';
import { withCache } from '../src/lib/embedder';

// Deterministic fake: each word maps to a fixed 2D vector by first letter code.
const fakeEmbedder = withCache(async (w: string) => {
  const angle = (w.charCodeAt(0) % 16) * (Math.PI / 16);
  return new Float32Array([Math.cos(angle), Math.sin(angle)]);
});

describe('generatePuzzle', () => {
  it('returns two distinct words below the similarity ceiling', async () => {
    const nouns = ['apple', 'banana', 'rocket', 'zebra', 'mountain', 'piano'];
    let i = 0;
    const rng = () => [0.05, 0.5, 0.95, 0.2, 0.8, 0.35][i++ % 6]; // deterministic
    const p = await generatePuzzle(fakeEmbedder, { nouns, ceiling: 0.25, rng });
    expect(p.a).not.toBe(p.b);
    expect(p.simAB).toBeLessThan(0.25);
    expect(nouns).toContain(p.a);
    expect(nouns).toContain(p.b);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/puzzles.test.ts` — Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement nouns list**

`src/lib/words/nouns.ts`:

```ts
// Curated concrete nouns for target generation. Expand freely.
export const NOUNS: string[] = [
  'cow', 'rocket', 'piano', 'mountain', 'river', 'coffee', 'pirate', 'planet',
  'guitar', 'forest', 'castle', 'engine', 'desert', 'island', 'wizard', 'thunder',
  'garden', 'diamond', 'tiger', 'compass', 'harbor', 'volcano', 'lantern', 'meadow',
  'anchor', 'cookie', 'glacier', 'circus', 'temple', 'feather', 'magnet', 'orchard',
  'saddle', 'bridge', 'ladder', 'puzzle', 'rocketship', 'velvet', 'whistle', 'pillow',
];
```

- [ ] **Step 4: Implement the generator**

`src/lib/puzzles.ts`:

```ts
import type { Embedder } from './embedder';
import { cosineSimilarity } from './math';
import { NOUNS } from './words/nouns';

export interface Puzzle {
  a: string;
  b: string;
  simAB: number;
}

export interface PuzzleOptions {
  nouns?: string[];
  ceiling?: number;       // max allowed sim between the two targets
  rng?: () => number;     // injectable for tests
  maxTries?: number;
}

export async function generatePuzzle(
  embedder: Embedder,
  opts: PuzzleOptions = {},
): Promise<Puzzle> {
  const nouns = opts.nouns ?? NOUNS;
  const ceiling = opts.ceiling ?? 0.25;
  const rng = opts.rng ?? Math.random;
  const maxTries = opts.maxTries ?? 50;

  const pick = () => nouns[Math.floor(rng() * nouns.length)];

  let fallback: Puzzle | null = null;
  for (let t = 0; t < maxTries; t++) {
    const a = pick();
    let b = pick();
    if (a === b) continue;
    const [va, vb] = await Promise.all([embedder.embed(a), embedder.embed(b)]);
    const simAB = cosineSimilarity(va, vb);
    const candidate: Puzzle = { a, b, simAB };
    if (simAB < ceiling) return candidate;
    if (!fallback || simAB < fallback.simAB) fallback = candidate;
  }
  if (!fallback) throw new Error('could not generate a puzzle');
  return fallback; // best (lowest-sim) pair we found
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/puzzles.test.ts` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/words/nouns.ts src/lib/puzzles.ts tests/puzzles.test.ts
git commit -m "feat: add target-pair puzzle generator"
```

---

## Task 10: Stats persistence

**Files:**
- Create: `src/lib/stats.ts`
- Test: covered inside `tests/game.test.ts` (Task 11)

- [ ] **Step 1: Implement**

`src/lib/stats.ts`:

```ts
export interface Stats {
  played: number;
  won: number;
  best: number | null;   // lowest word count across wins
  streak: number;
}

const KEY = 'linxicon:stats';

export function loadStats(): Stats {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Stats;
  } catch { /* ignore */ }
  return { played: 0, won: 0, best: null, streak: 0 };
}

export function saveStats(stats: Stats): void {
  try { localStorage.setItem(KEY, JSON.stringify(stats)); } catch { /* ignore */ }
}

export function recordWin(stats: Stats, wordCount: number): Stats {
  return {
    played: stats.played + 1,
    won: stats.won + 1,
    best: stats.best === null ? wordCount : Math.min(stats.best, wordCount),
    streak: stats.streak + 1,
  };
}

export function recordSkip(stats: Stats): Stats {
  return { ...stats, played: stats.played + 1, streak: 0 };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/stats.ts
git commit -m "feat: add stats persistence (best score + streak)"
```

---

## Task 11: Game store (orchestration)

The store is the testable seam between the pure engine and the UI. Dependencies are injected so it can be unit-tested without a model or DOM graph.

**Files:**
- Create: `src/lib/game.ts`
- Test: `tests/game.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/game.test.ts`:

```ts
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
const generatePuzzle = async () => ({ a: 'alpha', b: 'omega', simAB: 0 });

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
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/game.test.ts` — Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement the store**

`src/lib/game.ts`:

```ts
import { writable, type Readable } from 'svelte/store';
import { GameEngine } from './engine/engine';
import type { WordNode, Edge } from './engine/types';
import type { Embedder } from './embedder';
import type { ValidationResult } from './dictionary';
import type { Puzzle } from './puzzles';
import { loadStats, saveStats, recordWin, recordSkip, type Stats } from './stats';

export interface GameState {
  targetA: string;
  targetB: string;
  nodes: WordNode[];
  edges: Edge[];
  gap: number;
  solved: boolean;
  wordCount: number;
  lastWord: string | null;
}

export interface SubmitResult {
  ok: boolean;
  reason?: 'malformed' | 'unknown' | 'duplicate';
}

export interface GameDeps {
  embedder: Embedder;
  validateWord: (raw: string) => ValidationResult;
  generatePuzzle: () => Promise<Puzzle>;
}

const EMPTY: GameState = {
  targetA: '', targetB: '', nodes: [], edges: [], gap: 0,
  solved: false, wordCount: 0, lastWord: null,
};

export function createGame(deps: GameDeps) {
  const state = writable<GameState>(EMPTY);
  const stats = writable<Stats>(loadStats());
  let engine: GameEngine | null = null;
  let wonThisGame = false;

  function snapshot(lastWord: string | null): GameState {
    const e = engine!;
    return {
      targetA: e.targetA,
      targetB: e.targetB,
      nodes: e.getNodes(),
      edges: e.getEdges(),
      gap: e.closestGap(),
      solved: e.isSolved(),
      wordCount: e.wordCount(),
      lastWord,
    };
  }

  async function newGame(): Promise<void> {
    const p = await deps.generatePuzzle();
    const [va, vb] = await Promise.all([deps.embedder.embed(p.a), deps.embedder.embed(p.b)]);
    engine = new GameEngine({ word: p.a, vector: va }, { word: p.b, vector: vb });
    wonThisGame = false;
    state.set(snapshot(null));
  }

  async function submitWord(raw: string): Promise<SubmitResult> {
    if (!engine) return { ok: false };
    const v = deps.validateWord(raw);
    if (!v.ok) return { ok: false, reason: v.reason };
    if (engine.has(v.word)) return { ok: false, reason: 'duplicate' };

    const vec = await deps.embedder.embed(v.word);
    engine.addWord(v.word, vec);
    state.set(snapshot(v.word));

    if (engine.isSolved() && !wonThisGame) {
      wonThisGame = true;
      stats.update((s) => {
        const next = recordWin(s, engine!.wordCount());
        saveStats(next);
        return next;
      });
    }
    return { ok: true };
  }

  function skip(): void {
    if (!wonThisGame) {
      stats.update((s) => { const next = recordSkip(s); saveStats(next); return next; });
    }
  }

  return {
    state: state as Readable<GameState>,
    stats: stats as Readable<Stats>,
    newGame,
    submitWord,
    skip,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/game.test.ts` — Expected: PASS (5 tests).

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run` — Expected: PASS (all tests, all files).

- [ ] **Step 6: Commit**

```bash
git add src/lib/game.ts tests/game.test.ts
git commit -m "feat: add game store orchestrating engine, embedder, and stats"
```

---

## Task 12: Graph component (d3-force + SVG)

UI task — implementation + manual verification (no unit test).

**Files:**
- Create: `src/components/Graph.svelte`

- [ ] **Step 1: Implement**

`src/components/Graph.svelte`:

```svelte
<script lang="ts">
  import { onDestroy } from 'svelte';
  import {
    forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide,
    type Simulation,
  } from 'd3-force';
  import type { WordNode, Edge } from '../lib/engine/types';

  export let nodes: WordNode[] = [];
  export let edges: Edge[] = [];
  export let targetA = '';
  export let targetB = '';
  export let lastWord: string | null = null;

  type SimNode = { id: string; isTarget: boolean; x?: number; y?: number; fx?: number; fy?: number };
  type SimLink = { source: string; target: string; sim: number };

  let width = 800, height = 600;
  let simNodes: SimNode[] = [];
  let simLinks: SimLink[] = [];
  let positions: Record<string, { x: number; y: number }> = {};
  let sim: Simulation<SimNode, undefined> | null = null;

  function rebuild() {
    const existing = new Map(simNodes.map((n) => [n.id, n]));
    simNodes = nodes.map((n) => existing.get(n.id) ?? { id: n.id, isTarget: n.isTarget, x: width / 2 + (Math.random() - 0.5) * 40, y: height / 2 + (Math.random() - 0.5) * 40 });
    simLinks = edges.map((e) => ({ source: e.a, target: e.b, sim: e.sim }));

    if (!sim) {
      sim = forceSimulation<SimNode>(simNodes)
        .force('charge', forceManyBody().strength(-400))
        .force('center', forceCenter(width / 2, height / 2))
        .force('collide', forceCollide(40))
        .force('link', forceLink<SimNode, SimLink>(simLinks).id((d) => d.id).distance(120).strength(0.6))
        .on('tick', () => {
          positions = Object.fromEntries(simNodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
        });
    } else {
      sim.nodes(simNodes);
      (sim.force('link') as any).links(simLinks);
      sim.alpha(0.8).restart();
    }
  }

  $: nodes, edges, rebuild();
  onDestroy(() => sim?.stop());
</script>

<svg viewBox={`0 0 ${width} ${height}`} class="graph">
  {#each simLinks as l (l.source + '-' + l.target)}
    {#if positions[typeof l.source === 'string' ? l.source : (l.source as any).id] && positions[typeof l.target === 'string' ? l.target : (l.target as any).id]}
      {@const s = positions[typeof l.source === 'string' ? l.source : (l.source as any).id]}
      {@const t = positions[typeof l.target === 'string' ? l.target : (l.target as any).id]}
      <line x1={s.x} y1={s.y} x2={t.x} y2={t.y}
        stroke="#6b7fd7" stroke-width={1 + l.sim * 4} stroke-opacity={0.3 + l.sim * 0.5} />
    {/if}
  {/each}
  {#each simNodes as n (n.id)}
    {#if positions[n.id]}
      {@const p = positions[n.id]}
      {@const isTarget = n.id === targetA || n.id === targetB}
      <g transform={`translate(${p.x}, ${p.y})`} class:pop={n.id === lastWord}>
        <circle r="26" fill={isTarget ? '#e8c547' : '#2b3b6b'} stroke="#cdd6ff" stroke-width="2" />
        <text text-anchor="middle" dy="5" fill={isTarget ? '#1a1a2e' : '#eaeefb'} font-size="13">{n.id}</text>
      </g>
    {/if}
  {/each}
</svg>

<style>
  .graph { width: 100%; height: 100%; display: block; background: #11152b; border-radius: 12px; }
  .pop circle { animation: pop 0.4s ease-out; }
  @keyframes pop { from { r: 4; } to { r: 26; } }
  text { user-select: none; pointer-events: none; font-family: system-ui, sans-serif; }
</style>
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit` — Expected: no errors (resolve d3-force link typing as needed).

- [ ] **Step 3: Commit**

```bash
git add src/components/Graph.svelte
git commit -m "feat: add d3-force graph component rendered to SVG"
```

---

## Task 13: HUD + Win modal

**Files:**
- Create: `src/components/Hud.svelte`, `src/components/WinModal.svelte`

- [ ] **Step 1: Implement HUD**

`src/components/Hud.svelte`:

```svelte
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  export let targetA = '';
  export let targetB = '';
  export let wordCount = 0;
  export let gap = 0;
  export let best: number | null = null;
  export let error: string | null = null;
  export let disabled = false;

  let value = '';
  const dispatch = createEventDispatcher<{ submit: string; newgame: void }>();

  function submit() {
    const w = value.trim();
    if (!w) return;
    dispatch('submit', w);
    value = '';
  }
</script>

<div class="hud">
  <div class="targets">
    <span class="target">{targetA}</span>
    <span class="gap">gap {(gap * 100).toFixed(1)}%</span>
    <span class="target">{targetB}</span>
  </div>
  <form on:submit|preventDefault={submit}>
    <input bind:value placeholder="add a word…" {disabled} autocomplete="off" />
    <button type="submit" {disabled}>Add</button>
    <button type="button" on:click={() => dispatch('newgame')}>New game</button>
  </form>
  <div class="stats">
    <span>words used: {wordCount}</span>
    <span>best: {best ?? '—'}</span>
    {#if error}<span class="error">{error}</span>{/if}
  </div>
</div>

<style>
  .hud { display: flex; flex-direction: column; gap: 8px; padding: 12px; color: #eaeefb; font-family: system-ui, sans-serif; }
  .targets { display: flex; align-items: center; justify-content: center; gap: 16px; font-size: 22px; font-weight: 600; }
  .target { color: #e8c547; }
  .gap { font-size: 14px; color: #9fb0ff; }
  form { display: flex; gap: 8px; justify-content: center; }
  input { padding: 8px 12px; border-radius: 8px; border: 1px solid #3a4a7a; background: #1a2142; color: #eaeefb; }
  button { padding: 8px 14px; border-radius: 8px; border: none; background: #3a4a7a; color: #eaeefb; cursor: pointer; }
  .stats { display: flex; gap: 16px; justify-content: center; font-size: 13px; color: #9fb0ff; }
  .error { color: #ff8a8a; }
</style>
```

- [ ] **Step 2: Implement Win modal**

`src/components/WinModal.svelte`:

```svelte
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  export let wordCount = 0;
  export let best: number | null = null;
  const dispatch = createEventDispatcher<{ again: void }>();
</script>

<div class="backdrop">
  <div class="modal">
    <h2>Connected! 🎉</h2>
    <p>You bridged them with <strong>{wordCount}</strong> word{wordCount === 1 ? '' : 's'}.</p>
    <p class="best">Best: {best ?? wordCount}</p>
    <button on:click={() => dispatch('again')}>Play again</button>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(10, 12, 28, 0.7); display: grid; place-items: center; }
  .modal { background: #1a2142; color: #eaeefb; padding: 28px 36px; border-radius: 16px; text-align: center; font-family: system-ui, sans-serif; }
  button { margin-top: 12px; padding: 10px 18px; border: none; border-radius: 8px; background: #e8c547; color: #1a1a2e; font-weight: 600; cursor: pointer; }
  .best { color: #9fb0ff; }
</style>
```

- [ ] **Step 3: Commit**

```bash
git add src/components/Hud.svelte src/components/WinModal.svelte
git commit -m "feat: add HUD and win modal components"
```

---

## Task 14: App shell + wiring

**Files:**
- Modify: `src/App.svelte`, `src/main.ts`

- [ ] **Step 1: Implement App**

`src/App.svelte` (replace generated content):

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import Graph from './components/Graph.svelte';
  import Hud from './components/Hud.svelte';
  import WinModal from './components/WinModal.svelte';
  import { createGame } from './lib/game';
  import { createEmbeddings } from './lib/embeddings';
  import { validateWord } from './lib/dictionary';
  import { generatePuzzle } from './lib/puzzles';

  const emb = createEmbeddings();
  const game = createGame({
    embedder: emb.embedder,
    validateWord,
    generatePuzzle: () => generatePuzzle(emb.embedder),
  });
  const { state, stats } = game;

  let progress = 0;
  let ready = false;
  let error: string | null = null;

  emb.onProgress((p) => (progress = p));
  emb.onReady(async () => { ready = true; await game.newGame(); });

  async function onSubmit(e: CustomEvent<string>) {
    error = null;
    const res = await game.submitWord(e.detail);
    if (!res.ok) {
      error = res.reason === 'duplicate' ? 'already on the board'
        : res.reason === 'unknown' ? 'not a recognized word'
        : 'enter a single word';
    }
  }

  function onNewGame() { game.skip(); error = null; game.newGame(); }
</script>

<main>
  {#if !ready}
    <div class="loading">
      <h1>Linxicon</h1>
      <p>Loading word model… {Math.round(progress)}%</p>
    </div>
  {:else}
    <Hud
      targetA={$state.targetA} targetB={$state.targetB}
      wordCount={$state.wordCount} gap={$state.gap}
      best={$stats.best} {error}
      on:submit={onSubmit} on:newgame={onNewGame} />
    <div class="canvas">
      <Graph
        nodes={$state.nodes} edges={$state.edges}
        targetA={$state.targetA} targetB={$state.targetB}
        lastWord={$state.lastWord} />
    </div>
    {#if $state.solved}
      <WinModal wordCount={$state.wordCount} best={$stats.best} on:again={onNewGame} />
    {/if}
  {/if}
</main>

<style>
  :global(body) { margin: 0; background: #0b0e1f; }
  main { display: flex; flex-direction: column; height: 100vh; }
  .canvas { flex: 1; padding: 12px; }
  .loading { display: grid; place-items: center; height: 100vh; color: #eaeefb; font-family: system-ui, sans-serif; text-align: center; }
  h1 { color: #e8c547; }
</style>
```

- [ ] **Step 2: Verify main.ts mounts App**

Ensure `src/main.ts` mounts `App` into `#app` (the Vite template default). No change needed if it already does.

- [ ] **Step 3: Type-check and build**

Run: `npx tsc --noEmit` — Expected: no errors.
Run: `npm run build` — Expected: build succeeds, output in `dist/`.

- [ ] **Step 4: Manual end-to-end verification**

Run: `npm run dev`, open `http://localhost:5173`.
Expected behavior:
1. "Loading word model… N%" appears, progressing to 100% on first load (model downloads once).
2. Two target words appear with a "gap %" readout; the graph shows two nodes.
3. Typing a real word adds a node; words ≥ 41% similar to something on the board draw a connecting edge that springs into place.
4. Bridging the two targets pops the win modal with the word count; "best" updates.
5. "New game" / "Play again" generates a fresh pair.
6. Unknown words show "not a recognized word"; duplicates show "already on the board".
7. Reload the page — the model loads instantly from cache (offline works after first load).

- [ ] **Step 5: Commit**

```bash
git add src/App.svelte src/main.ts
git commit -m "feat: wire app shell, loading state, and components together"
```

---

## Task 15: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README**

`README.md`:

```markdown
# Linxicon (recreation)

Bridge two unrelated words by adding intermediate words to a live graph. Words
auto-connect when their semantic similarity is at least 41%. Win by connecting the
two targets — using as few words as possible.

- Semantic similarity from an in-browser MiniLM model (`@huggingface/transformers`).
- Live force-directed graph via `d3-force` + Svelte/SVG.
- Infinite puzzles, no backend.

## Develop
\`\`\`bash
npm install
npm run dev      # http://localhost:5173
npm test         # run the test suite
npm run build    # static build to dist/
\`\`\`
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README"
```

---

## Self-Review Notes (completed during planning)

- **Spec coverage:** in-browser embeddings (Tasks 7–8), 41% threshold (Tasks 3–4, `DEFAULT_THRESHOLD`), fewest-words scoring (Task 5 + store), live SVG graph (Task 12), infinite puzzles (Task 9 + `newGame`), dictionary validation (Task 6), error handling (store + App), streak + best persistence (Tasks 10–11), worker-based model + caching (Tasks 7–8). All covered.
- **Type consistency:** `WordSeed`/`WordNode`/`Edge` defined once (Task 3) and reused; engine methods (`addWord`, `getEdges`, `getNodes`, `has`, `closestGap`, `isSolved`, `wordCount`) named consistently across store and components; `Embedder`/`PersistentStore`/`ValidationResult`/`Puzzle`/`Stats` interfaces reused by name.
- **Placeholders:** none — every code step contains full code. The two large data files (`dictionary.json`, expanded `nouns.ts`) have explicit sourcing instructions rather than inline contents by necessity.
```
