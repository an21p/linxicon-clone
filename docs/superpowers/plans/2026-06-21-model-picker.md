# Model Picker (MiniLM ⇄ Numberbatch) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dropdown that switches the similarity backend between the existing in-browser MiniLM (384-dim) and a new precomputed ConceptNet Numberbatch lookup (300-dim), re-scoring the current puzzle on switch.

**Architecture:** A shared curated vocabulary (wordfreq top-N ∩ Numberbatch ∩ current dictionary) is generated offline; it becomes the new `dictionary.json` and drives a quantized int8 Numberbatch matrix shipped under `public/`. A model registry + `createEmbeddings(modelId)` factory selects between two web workers (MiniLM via `@huggingface/transformers`, Numberbatch via a static-asset lookup). The vector cache is namespaced by model id so 384-dim and 300-dim vectors never collide. `game.ts` gains the ability to swap the embedder and re-embed the live graph; `Hud.svelte` exposes the picker; `App.svelte` orchestrates teardown/reload/re-score and persists the choice.

**Tech Stack:** Svelte 5, Vite, TypeScript, Vitest, web workers, `@huggingface/transformers`, `idb-keyval`; offline build in Python (`/tmp/linx-venv` with numpy + wordfreq).

---

## Established Facts (verified against the repo)

- `createEmbeddings()` (src/lib/embeddings.ts) takes **no args**; constructs the MiniLM worker; builds a `PersistentStore` keyed `vec:${key}`. Returns `{ embedder, onProgress, onReady, onError }`.
- `withCache(embedFn, store)` (src/lib/embedder.ts) normalizes `word.trim().toLowerCase()` and is dimension-agnostic. The cache key the store sees is already the normalized word.
- `GameEngine` (src/lib/engine/engine.ts) exposes `readonly targetA`, `readonly targetB`, `getNodes()` (returns `{id, vector, isTarget}`, insertion order: targetA, targetB, then intermediates), `addWord(word, vector)`, `closestGap()`, `isSolved()`. Math is cosine-only and dimension-agnostic.
- `createGame(deps)` (src/lib/game.ts): `deps = { embedder, validateWord, generatePuzzle }` where `generatePuzzle: () => Promise<Puzzle>`. `newGame()` embeds both targets and builds a fresh `GameEngine`. `submitWord` records the win. Exposes `{ state, stats, newGame, submitWord, skip }`.
- `generatePuzzle(embedder, opts)` (src/lib/puzzles.ts) embeds candidate nouns; ceiling default 0.25.
- `App.svelte` wires `createEmbeddings()` → `createGame({ embedder, validateWord, generatePuzzle: () => generatePuzzle(emb.embedder) })`, drives `onProgress/onReady/onError`, shows a `!ready` loading screen.
- `Hud.svelte` is a presentational component dispatching `submit` / `newgame`.
- `dictionary.json` is a JSON **array** of 370,105 lowercase words (`resolveJsonModule: true`). `DICTIONARY = new Set(rawWords)`.
- `nouns.ts` exports `NOUNS: string[]` (40 hand-picked concrete nouns).
- Tests live in `tests/**/*.test.ts` (vitest, jsdom, globals). Existing: dictionary, embedder, engine, game, math, puzzles. `dictionary.test.ts` and `puzzles.test.ts` use **their own** word lists, so regenerating `dictionary.json` / `nouns.ts` does not touch them.
- `/tmp/numberbatch-en.txt.gz` — word2vec **text** format. Header line `516782 300`; each subsequent line is `word v0 v1 … v299` with **bare** tokens (multi-word concepts use `_`). 300-dim.
- `/tmp/linx-venv/bin/python` — numpy 2.4.6 + wordfreq; `wordfreq.top_n_list('en', 40000)` returns 40000 words.
- Vite `base` is default `'/'`; `import.meta.env.BASE_URL` is available in workers under Vite.

## Named Constants (single source of truth)

- `TOP_N = 40000` — wordfreq vocabulary cap. Lives in the build script.
- `QUANT_SCALE = 127` — int8 quantization scale. Lives in **both** the build script and `src/lib/numberbatch.ts` (with a comment noting they must match).
- `NUMBERBATCH_DIM = 300` — in `src/lib/models.ts` (and asserted by the index).
- `DEFAULT_MODEL = 'numberbatch'` — in `src/lib/models.ts`.

## File Structure

- Create `scripts/build-vectors.py` — offline: curated vocab + quantized matrix + regenerated dictionary; prints stats & dropped nouns.
- Overwrite `src/lib/words/dictionary.json` — exactly the curated set (sorted).
- Modify `src/lib/words/nouns.ts` — drop nouns not in curated set.
- Create `public/numberbatch.bin` — int8 matrix, row-major N×300 (generated, git-committed).
- Create `public/numberbatch-index.json` — `{ dim:300, words:[...] }` (generated, git-committed).
- Create `src/lib/models.ts` — model registry + constants.
- Create `src/lib/numberbatch.ts` — pure dequantize/lookup helpers (testable).
- Create `src/lib/numberbatch.worker.ts` — fetch assets, report progress, serve lookups.
- Modify `src/lib/embeddings.ts` — `createEmbeddings(modelId)`, namespaced cache, `destroy()`, worker selection.
- Modify `src/lib/game.ts` — `setEmbedder`, `reEmbedCurrent`, embedder-parameterized `generatePuzzle`.
- Modify `src/components/Hud.svelte` — `<select>` model picker.
- Modify `src/App.svelte` — model-switch orchestration + localStorage.
- Tests: `tests/numberbatch.test.ts` (new), `tests/embeddings-cache.test.ts` (new), additions to `tests/game.test.ts`.

---

### Task 1: Offline build — curated vocab, quantized matrix, regenerated dictionary

**Files:**
- Create: `scripts/build-vectors.py`
- Overwrite: `src/lib/words/dictionary.json`
- Create: `public/numberbatch.bin`, `public/numberbatch-index.json`

- [ ] **Step 1: Write the build script**

Create `scripts/build-vectors.py`:

```python
#!/usr/bin/env python3
"""Build the curated vocabulary + quantized Numberbatch assets.

Run with the prepared venv:
    /tmp/linx-venv/bin/python scripts/build-vectors.py

Inputs (reused, never re-downloaded):
    /tmp/numberbatch-en.txt.gz   ConceptNet Numberbatch 19.08 EN, 300-dim, word2vec text
Outputs:
    src/lib/words/dictionary.json   curated word list (sorted) -- the playable set
    public/numberbatch.bin          int8 matrix, row-major N x DIM
    public/numberbatch-index.json   {"dim": DIM, "words": [...]}, row i = words[i]
"""
import gzip
import json
import os
import sys

import numpy as np
import wordfreq

# --- named constants (keep QUANT_SCALE in sync with src/lib/numberbatch.ts) ---
TOP_N = 40000
QUANT_SCALE = 127
DIM = 300

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GZ = "/tmp/numberbatch-en.txt.gz"
DICT_PATH = os.path.join(ROOT, "src", "lib", "words", "dictionary.json")
BIN_PATH = os.path.join(ROOT, "public", "numberbatch.bin")
INDEX_PATH = os.path.join(ROOT, "public", "numberbatch-index.json")
NOUNS_PATH = os.path.join(ROOT, "src", "lib", "words", "nouns.ts")

def load_current_dictionary():
    with open(DICT_PATH, encoding="utf-8") as f:
        return set(json.load(f))

def load_nouns():
    # crude extract of single-quoted tokens from nouns.ts, for the drop report
    import re
    with open(NOUNS_PATH, encoding="utf-8") as f:
        body = f.read()
    return [m for m in re.findall(r"'([a-z][a-z'-]*)'", body)]

def main():
    top = set(wordfreq.top_n_list("en", TOP_N))
    current = load_current_dictionary()
    allow = top & current  # candidate words; intersect Numberbatch during the stream

    rows = {}   # word -> np.float32[DIM]
    seen_nb = 0
    with gzip.open(GZ, "rt", encoding="utf-8") as f:
        header = f.readline().split()
        assert int(header[1]) == DIM, f"unexpected dim {header[1]}"
        for line in f:
            sp = line.rstrip("\n").split(" ")
            word = sp[0]
            seen_nb += 1
            if word not in allow:
                continue
            vec = np.asarray(sp[1:1 + DIM], dtype=np.float32)
            if vec.shape[0] != DIM:
                continue
            rows[word] = vec

    words = sorted(rows)               # deterministic row order
    n = len(words)
    if n == 0:
        sys.exit("ERROR: empty curated vocabulary")

    mat = np.zeros((n, DIM), dtype=np.int8)
    for i, w in enumerate(words):
        v = rows[w]
        norm = np.linalg.norm(v)
        if norm > 0:
            v = v / norm
        q = np.clip(np.round(v * QUANT_SCALE), -QUANT_SCALE, QUANT_SCALE)
        mat[i] = q.astype(np.int8)

    # --- write assets ---
    with open(DICT_PATH, "w", encoding="utf-8") as f:
        json.dump(words, f)
    mat.tofile(BIN_PATH)
    with open(INDEX_PATH, "w", encoding="utf-8") as f:
        json.dump({"dim": DIM, "words": words}, f)

    # --- report ---
    dropped_nouns = [w for w in load_nouns() if w not in rows]
    bin_bytes = os.path.getsize(BIN_PATH)
    idx_bytes = os.path.getsize(INDEX_PATH)
    print(f"TOP_N                = {TOP_N}")
    print(f"numberbatch lines    = {seen_nb}")
    print(f"curated vocab size   = {n}")
    print(f"numberbatch.bin      = {bin_bytes} bytes ({bin_bytes/1e6:.2f} MB)")
    print(f"numberbatch-index    = {idx_bytes} bytes ({idx_bytes/1e6:.2f} MB)")
    print(f"dropped nouns ({len(dropped_nouns)}): {dropped_nouns}")

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the build script**

Run: `cd /Users/pishias/code/linxicon2 && /tmp/linx-venv/bin/python scripts/build-vectors.py`
Expected: prints `curated vocab size`, `numberbatch.bin` byte size, `numberbatch-index` byte size, and `dropped nouns (...)`. **Record the printed numbers** — they are pasted as verification proof. `n` is expected in the ~10k–25k range.

- [ ] **Step 3: Confirm assets and dictionary shape**

Run:
```bash
ls -l public/numberbatch.bin public/numberbatch-index.json
/tmp/linx-venv/bin/python - <<'PY'
import json, os
words = json.load(open('src/lib/words/dictionary.json'))
idx = json.load(open('src/lib/words/../words/dictionary.json'))  # noqa
ix = json.load(open('public/numberbatch-index.json'))
n = len(ix['words']); dim = ix['dim']
binbytes = os.path.getsize('public/numberbatch.bin')
assert dim == 300
assert binbytes == n * dim, (binbytes, n*dim)
assert words == ix['words'], 'dictionary must equal index words'
print('OK n=', n, 'dim=', dim, 'bin=', binbytes)
PY
```
Expected: `OK n=<N> dim=300 bin=<N*300>` with no assertion error (proves `bin` size == N×300 and dictionary == index words).

- [ ] **Step 4: Commit**

```bash
git add scripts/build-vectors.py src/lib/words/dictionary.json public/numberbatch.bin public/numberbatch-index.json
git commit -m "feat: build curated vocab + quantized Numberbatch assets"
```

---

### Task 2: Reconcile nouns.ts to the curated set

**Files:**
- Modify: `src/lib/words/nouns.ts`

- [ ] **Step 1: Remove dropped nouns**

From Task 1 Step 2 output, take the `dropped nouns (...)` list. Edit `src/lib/words/nouns.ts` and delete exactly those words from the `NOUNS` array (e.g. if `'rocketship'` is dropped, remove it). Keep every other noun. Do not add new words.

- [ ] **Step 2: Verify all remaining nouns are playable**

Run:
```bash
/tmp/linx-venv/bin/python - <<'PY'
import json, re
words = set(json.load(open('src/lib/words/dictionary.json')))
body = open('src/lib/words/nouns.ts').read()
nouns = re.findall(r"'([a-z][a-z'-]*)'", body)
missing = [w for w in nouns if w not in words]
print('nouns:', len(nouns), 'missing:', missing)
assert not missing, missing
PY
```
Expected: `missing: []` and assertion passes (every puzzle noun has a Numberbatch vector and is in the dictionary).

- [ ] **Step 3: Commit**

```bash
git add src/lib/words/nouns.ts
git commit -m "chore: reconcile puzzle nouns to curated vocabulary"
```

---

### Task 3: Numberbatch pure helpers (TDD)

**Files:**
- Create: `src/lib/numberbatch.ts`
- Test: `tests/numberbatch.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/numberbatch.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { dequantize, buildIndex, lookup, NUMBERBATCH_QUANT_SCALE } from '../src/lib/numberbatch';

describe('numberbatch helpers', () => {
  it('dequantizes an int8 row to a unit-norm Float32Array of the same length', () => {
    const row = new Int8Array([NUMBERBATCH_QUANT_SCALE, 0, 0]); // -> [1,0,0] after normalize
    const v = dequantize(row);
    expect(v).toBeInstanceOf(Float32Array);
    expect(v.length).toBe(3);
    const norm = Math.hypot(...v);
    expect(norm).toBeCloseTo(1, 5);
    expect(v[0]).toBeCloseTo(1, 5);
  });

  it('buildIndex maps each word to its row', () => {
    const idx = buildIndex(['cat', 'cow', 'milk']);
    expect(idx.get('cow')).toBe(1);
    expect(idx.has('zzz')).toBe(false);
  });

  it('lookup returns a 300-dim normalized vector for a known word and null otherwise', () => {
    const dim = 300;
    const words = ['cat', 'cow'];
    const matrix = new Int8Array(words.length * dim);
    // give "cow" (row 1) a nonzero first component
    matrix[1 * dim + 0] = NUMBERBATCH_QUANT_SCALE;
    const idx = buildIndex(words);
    const v = lookup(idx, matrix, dim, 'cow');
    expect(v).not.toBeNull();
    expect(v!.length).toBe(300);
    expect(Math.hypot(...v!)).toBeCloseTo(1, 5);
    expect(lookup(idx, matrix, dim, 'nope')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/numberbatch.test.ts`
Expected: FAIL — cannot resolve `../src/lib/numberbatch`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/numberbatch.ts`:

```typescript
// QUANT_SCALE must match scripts/build-vectors.py (QUANT_SCALE = 127).
export const NUMBERBATCH_QUANT_SCALE = 127;

/** Int8 row -> L2-normalized Float32Array of the same length. */
export function dequantize(row: Int8Array): Float32Array {
  const out = new Float32Array(row.length);
  let n = 0;
  for (let i = 0; i < row.length; i++) {
    const v = row[i] / NUMBERBATCH_QUANT_SCALE;
    out[i] = v;
    n += v * v;
  }
  n = Math.sqrt(n);
  if (n > 0) for (let i = 0; i < out.length; i++) out[i] /= n;
  return out;
}

export function buildIndex(words: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < words.length; i++) m.set(words[i], i);
  return m;
}

/** Dequantized, normalized vector for `word`, or null if absent. */
export function lookup(
  index: Map<string, number>,
  matrix: Int8Array,
  dim: number,
  word: string,
): Float32Array | null {
  const row = index.get(word);
  if (row === undefined) return null;
  return dequantize(matrix.subarray(row * dim, (row + 1) * dim));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/numberbatch.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/numberbatch.ts tests/numberbatch.test.ts
git commit -m "feat: numberbatch dequantize/lookup helpers with tests"
```

---

### Task 4: Model registry

**Files:**
- Create: `src/lib/models.ts`

- [ ] **Step 1: Write the registry**

Create `src/lib/models.ts`:

```typescript
export type ModelId = 'minilm' | 'numberbatch';

export interface ModelInfo {
  id: ModelId;
  label: string;
  dim: number;
}

export const NUMBERBATCH_DIM = 300;
export const MINILM_DIM = 384;

export const MODELS: Record<ModelId, ModelInfo> = {
  minilm: { id: 'minilm', label: 'all-MiniLM-L6-v2', dim: MINILM_DIM },
  numberbatch: { id: 'numberbatch', label: 'ConceptNet Numberbatch', dim: NUMBERBATCH_DIM },
};

export const MODEL_LIST: ModelInfo[] = Object.values(MODELS);

export const DEFAULT_MODEL: ModelId = 'numberbatch';

export function isModelId(v: unknown): v is ModelId {
  return v === 'minilm' || v === 'numberbatch';
}
```

- [ ] **Step 2: Type-check passes**

Run: `npm run check`
Expected: no new errors from `models.ts`. (Other tasks are incomplete; if `check` reports errors, they must all reference files not yet created/modified by later tasks — `models.ts` itself must be clean.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/models.ts
git commit -m "feat: model registry (minilm + numberbatch)"
```

---

### Task 5: Cache namespacing by model id (TDD)

**Files:**
- Modify: `src/lib/embeddings.ts`
- Test: `tests/embeddings-cache.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/embeddings-cache.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { cacheKey } from '../src/lib/embeddings';

describe('cache namespacing', () => {
  it('includes the model id so dims never collide', () => {
    expect(cacheKey('minilm', 'cow')).toBe('vec:minilm:cow');
    expect(cacheKey('numberbatch', 'cow')).toBe('vec:numberbatch:cow');
  });

  it('switching model changes the cache namespace for the same word', () => {
    expect(cacheKey('minilm', 'cow')).not.toBe(cacheKey('numberbatch', 'cow'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/embeddings-cache.test.ts`
Expected: FAIL — `cacheKey` is not exported from `embeddings.ts`.

- [ ] **Step 3: Add `cacheKey` and namespace the store**

Edit `src/lib/embeddings.ts`. Add the exported helper near the top (after imports) and use it in the store. Replace the existing store block. Full updated file:

```typescript
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { withCache, type Embedder, type PersistentStore } from './embedder';
import { DEFAULT_MODEL, type ModelId } from './models';

export interface EmbeddingsHandle {
  modelId: ModelId;
  embedder: Embedder;
  onProgress(cb: (progress: number) => void): void;
  onReady(cb: () => void): void;
  onError(cb: (message: string) => void): void;
  destroy(): void;
}

/** Namespaced so 384-dim and 300-dim vectors for the same word never collide. */
export function cacheKey(modelId: ModelId, word: string): string {
  return `vec:${modelId}:${word}`;
}

function makeWorker(modelId: ModelId): Worker {
  return modelId === 'numberbatch'
    ? new Worker(new URL('./numberbatch.worker.ts', import.meta.url), { type: 'module' })
    : new Worker(new URL('./embeddings.worker.ts', import.meta.url), { type: 'module' });
}

export function createEmbeddings(modelId: ModelId = DEFAULT_MODEL): EmbeddingsHandle {
  const worker = makeWorker(modelId);

  let nextId = 1;
  const pending = new Map<number, { resolve: (v: Float32Array) => void; reject: (e: Error) => void }>();
  let progressCb: ((p: number) => void) | null = null;
  let readyCb: (() => void) | null = null;
  let errorCb: ((message: string) => void) | null = null;

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

  worker.onerror = (ev: ErrorEvent) => {
    errorCb?.(ev.message || 'Failed to load the word model.');
  };

  const embedFn = (word: string) =>
    new Promise<Float32Array>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, word });
    });

  const store: PersistentStore = {
    async get(key) { return (await idbGet(cacheKey(modelId, key))) as Float32Array | undefined; },
    async set(key, value) { await idbSet(cacheKey(modelId, key), value); },
  };

  return {
    modelId,
    embedder: withCache(embedFn, store),
    onProgress(cb) { progressCb = cb; },
    onReady(cb) { readyCb = cb; },
    onError(cb) { errorCb = cb; },
    destroy() {
      worker.onmessage = null;
      worker.onerror = null;
      pending.clear();
      worker.terminate();
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/embeddings-cache.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/embeddings.ts tests/embeddings-cache.test.ts
git commit -m "feat: namespace vector cache by model id; add worker selection + destroy"
```

---

### Task 6: Numberbatch worker

**Files:**
- Create: `src/lib/numberbatch.worker.ts`

- [ ] **Step 1: Write the worker**

Create `src/lib/numberbatch.worker.ts`. It fetches the index + binary matrix (reporting download % from the larger `.bin`), builds the lookup, and serves `embed` requests using the Task 3 helpers.

```typescript
import { buildIndex, lookup } from './numberbatch';

interface IndexFile { dim: number; words: string[]; }

let ready: Promise<{ index: Map<string, number>; matrix: Int8Array; dim: number }> | null = null;

function asset(name: string): string {
  // BASE_URL respects a non-root Vite base; assets live at the site root (public/).
  const base = (import.meta as any).env?.BASE_URL ?? '/';
  return base + name;
}

async function fetchBinWithProgress(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  if (!res.body || !total) {
    const buf = await res.arrayBuffer();
    self.postMessage({ type: 'progress', progress: 100 });
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    self.postMessage({ type: 'progress', progress: (loaded / total) * 100 });
  }
  const out = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out.buffer;
}

function init() {
  if (!ready) {
    ready = (async () => {
      const index: IndexFile = await (await fetch(asset('numberbatch-index.json'))).json();
      const buf = await fetchBinWithProgress(asset('numberbatch.bin'));
      const matrix = new Int8Array(buf);
      const map = buildIndex(index.words);
      self.postMessage({ type: 'ready' });
      return { index: map, matrix, dim: index.dim };
    })();
  }
  return ready;
}

self.onmessage = async (ev: MessageEvent) => {
  const { id, word } = ev.data as { id: number; word: string };
  try {
    const { index, matrix, dim } = await init();
    const vec = lookup(index, matrix, dim, word);
    if (!vec) throw new Error(`no Numberbatch vector for "${word}"`);
    self.postMessage({ type: 'result', id, vector: vec }, { transfer: [vec.buffer] });
  } catch (err) {
    self.postMessage({ type: 'error', id, message: String(err) });
  }
};

// Kick off the download eagerly so progress starts immediately.
init();
```

- [ ] **Step 2: Type-check**

Run: `npm run check`
Expected: no errors referencing `numberbatch.worker.ts`. (Remaining errors, if any, must reference `game.ts`/`Hud.svelte`/`App.svelte` handled in later tasks.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/numberbatch.worker.ts
git commit -m "feat: numberbatch worker (fetch assets, progress, lookup)"
```

---

### Task 7: Game — swap embedder and re-embed the live graph (TDD)

**Files:**
- Modify: `src/lib/game.ts`
- Test: `tests/game.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/game.test.ts`. First change the existing `generatePuzzle` fixture to accept an embedder arg (the new signature), then append a re-embed test. Replace line 18:

```typescript
const generatePuzzle = async (_e: typeof embedder) => ({ a: 'alpha', b: 'omega', simAB: 0 });
```

Append inside the `describe('createGame', …)` block:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/game.test.ts`
Expected: FAIL — `game.setEmbedder` / `game.reEmbedCurrent` do not exist.

- [ ] **Step 3: Implement embedder swap + re-embed**

Edit `src/lib/game.ts`:

1. Change `GameDeps.generatePuzzle` type to take the embedder:

```typescript
export interface GameDeps {
  embedder: Embedder;
  validateWord: (raw: string) => ValidationResult;
  generatePuzzle: (embedder: Embedder) => Promise<Puzzle>;
}
```

2. In `createGame`, hold the embedder mutably. Replace the top of the function body (the `const state = …; let engine …` area) so it reads:

```typescript
export function createGame(deps: GameDeps) {
  const state = writable<GameState>(EMPTY);
  const stats = writable<Stats>(loadStats());
  let engine: GameEngine | null = null;
  let wonThisGame = false;
  let embedder = deps.embedder;
```

3. In `newGame`, use the mutable embedder + new `generatePuzzle` signature. Replace the two relevant lines:

```typescript
  async function newGame(): Promise<void> {
    const p = await deps.generatePuzzle(embedder);
    const [va, vb] = await Promise.all([embedder.embed(p.a), embedder.embed(p.b)]);
    engine = new GameEngine({ word: p.a, vector: va }, { word: p.b, vector: vb });
    wonThisGame = false;
    state.set(snapshot(null));
  }
```

4. In `submitWord`, change `deps.embedder.embed` to `embedder.embed`:

```typescript
    const vec = await embedder.embed(v.word);
```

5. Add the two new functions before `return {`:

```typescript
  function setEmbedder(e: Embedder): void {
    embedder = e;
  }

  /** Re-embed the current puzzle (same words) with the active embedder and rebuild edges/gap. */
  async function reEmbedCurrent(): Promise<void> {
    if (!engine) return;
    const a = engine.targetA;
    const b = engine.targetB;
    const inter = engine.getNodes().filter((n) => !n.isTarget).map((n) => n.id);
    const [va, vb] = await Promise.all([embedder.embed(a), embedder.embed(b)]);
    const next = new GameEngine({ word: a, vector: va }, { word: b, vector: vb });
    const vecs = await Promise.all(inter.map((w) => embedder.embed(w)));
    inter.forEach((w, i) => next.addWord(w, vecs[i]));
    engine = next;
    state.set(snapshot(null));
  }
```

6. Add both to the returned object:

```typescript
  return {
    state: state as Readable<GameState>,
    stats: stats as Readable<Stats>,
    newGame,
    submitWord,
    skip,
    setEmbedder,
    reEmbedCurrent,
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/game.test.ts`
Expected: PASS (all existing + the new re-embed test).

- [ ] **Step 5: Commit**

```bash
git add src/lib/game.ts tests/game.test.ts
git commit -m "feat: game can swap embedder and re-embed the live graph"
```

---

### Task 8: Hud — model picker `<select>`

**Files:**
- Modify: `src/components/Hud.svelte`

- [ ] **Step 1: Add the dropdown**

Edit `src/components/Hud.svelte`.

1. Extend the script: add imports + props + dispatch type. Replace the `<script>` top through the `dispatch` declaration:

```svelte
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { MODEL_LIST, type ModelId } from '../lib/models';
  export let targetA = '';
  export let targetB = '';
  export let wordCount = 0;
  export let gap = 0;
  export let best: number | null = null;
  export let error: string | null = null;
  export let disabled = false;
  export let model: ModelId;

  let value = '';
  const dispatch = createEventDispatcher<{ submit: string; newgame: void; model: ModelId }>();

  function submit() {
    const w = value.trim();
    if (!w) return;
    dispatch('submit', w);
    value = '';
  }

  function onModelChange(e: Event) {
    dispatch('model', (e.currentTarget as HTMLSelectElement).value as ModelId);
  }
</script>
```

2. Add the picker inside `.hud`, right after the `<form>…</form>` block:

```svelte
  <div class="model">
    <label for="model-select">model</label>
    <select id="model-select" bind:value={model} on:change={onModelChange} {disabled}>
      {#each MODEL_LIST as m}
        <option value={m.id}>{m.label}</option>
      {/each}
    </select>
  </div>
```

3. Add styles inside `<style>`:

```css
  .model { display: flex; align-items: center; gap: 8px; justify-content: center; font-size: 13px; color: #9fb0ff; }
  select { padding: 6px 10px; border-radius: 8px; border: 1px solid #3a4a7a; background: #1a2142; color: #eaeefb; }
```

- [ ] **Step 2: Type-check**

Run: `npm run check`
Expected: no errors referencing `Hud.svelte` (App wiring of the new `model` prop / `model` event is Task 9).

- [ ] **Step 3: Commit**

```bash
git add src/components/Hud.svelte
git commit -m "feat: model picker dropdown in HUD"
```

---

### Task 9: App — orchestrate model switch + persist choice

**Files:**
- Modify: `src/App.svelte`

- [ ] **Step 1: Wire model state, persistence, and switch flow**

Edit `src/App.svelte`. Replace the entire `<script>` block with:

```svelte
<script lang="ts">
  import Graph from './components/Graph.svelte';
  import Hud from './components/Hud.svelte';
  import WinModal from './components/WinModal.svelte';
  import { createGame } from './lib/game';
  import { createEmbeddings, type EmbeddingsHandle } from './lib/embeddings';
  import { validateWord } from './lib/dictionary';
  import { generatePuzzle } from './lib/puzzles';
  import { DEFAULT_MODEL, isModelId, type ModelId } from './lib/models';

  const STORAGE_KEY = 'linxicon.model';

  function loadModel(): ModelId {
    const saved = localStorage.getItem(STORAGE_KEY);
    return isModelId(saved) ? saved : DEFAULT_MODEL;
  }

  let model: ModelId = loadModel();
  let emb: EmbeddingsHandle = createEmbeddings(model);

  const game = createGame({
    embedder: emb.embedder,
    validateWord,
    generatePuzzle: (embedder) => generatePuzzle(embedder),
  });
  const { state, stats } = game;

  let progress = 0;
  let ready = false;
  let fatalError: string | null = null;
  let error: string | null = null;
  let busy = false;

  function bindEmbeddings(handle: EmbeddingsHandle, onReady: () => void | Promise<void>) {
    progress = 0;
    handle.onProgress((p) => (progress = p));
    handle.onReady(() => { void onReady(); });
    handle.onError((m) => (fatalError = m));
  }

  bindEmbeddings(emb, async () => {
    try { await game.newGame(); ready = true; }
    catch { fatalError = 'Could not start a game. Please reload.'; }
  });

  async function onModelChange(e: CustomEvent<ModelId>) {
    const next = e.detail;
    if (next === model || busy) return;
    model = next;
    localStorage.setItem(STORAGE_KEY, next);
    error = null;
    fatalError = null;
    busy = true;
    ready = false;            // show the load/progress screen while the new model inits
    emb.destroy();
    emb = createEmbeddings(next);
    game.setEmbedder(emb.embedder);
    bindEmbeddings(emb, async () => {
      try {
        await game.reEmbedCurrent();   // same puzzle, re-scored under the new backend
        ready = true;
      } catch {
        fatalError = 'Could not switch model. Please reload.';
      } finally {
        busy = false;
      }
    });
  }

  async function onSubmit(e: CustomEvent<string>) {
    if (busy) return;
    error = null;
    busy = true;
    try {
      const res = await game.submitWord(e.detail);
      if (!res.ok) {
        error = res.reason === 'duplicate' ? 'already on the board'
          : res.reason === 'unknown' ? 'not a recognized word'
          : 'enter a single word';
      }
    } catch {
      error = 'something went wrong adding that word';
    } finally {
      busy = false;
    }
  }

  async function onNewGame() {
    error = null;
    busy = true;
    try { game.skip(); await game.newGame(); }
    catch { error = 'could not start a new game'; }
    finally { busy = false; }
  }
</script>
```

2. In the markup, pass `model` and the handler to `<Hud>`. Replace the `<Hud … />` element with:

```svelte
    <Hud
      targetA={$state.targetA} targetB={$state.targetB}
      wordCount={$state.wordCount} gap={$state.gap}
      best={$stats.best} {error} disabled={busy} {model}
      on:submit={onSubmit} on:newgame={onNewGame} on:model={onModelChange} />
```

- [ ] **Step 2: Type-check passes (whole project)**

Run: `npm run check`
Expected: **clean** — zero errors (all tasks complete).

- [ ] **Step 3: Commit**

```bash
git add src/App.svelte
git commit -m "feat: orchestrate model switch, persist choice, re-score puzzle"
```

---

### Task 10: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Install**

Run: `npm install`
Expected: completes with no errors.

- [ ] **Step 2: Confirm build assets exist (from Task 1)**

Run: `ls -l public/numberbatch.bin public/numberbatch-index.json && node -e "const i=require('./public/numberbatch-index.json');const fs=require('fs');console.log('words',i.words.length,'dim',i.dim,'bin',fs.statSync('public/numberbatch.bin').size,'expected',i.words.length*i.dim)"`
Expected: `bin` equals `words*dim`. Paste sizes as proof.

- [ ] **Step 3: Tests**

Run: `npm test`
Expected: all suites PASS, including `tests/numberbatch.test.ts`, `tests/embeddings-cache.test.ts`, and the new re-embed case in `tests/game.test.ts`. Paste the summary line.

- [ ] **Step 4: Type-check**

Run: `npm run check`
Expected: clean (no errors). Paste output.

- [ ] **Step 5: Production build**

Run: `npm run build`
Expected: succeeds; `dist/` produced and the two Numberbatch assets are copied from `public/`. Paste the final build summary.

- [ ] **Step 6: Manual dev verification (paste a comparison)**

Run: `npm run dev`, open the app.
1. Load a puzzle under **MiniLM** (switch the dropdown to MiniLM if not already), connect a chain between the two targets, and note one edge's similarity % (e.g. `cow–milk = 31.2%`).
2. Switch the dropdown to **Numberbatch**. Confirm: the loading/progress state shows, then the **same words** re-appear (same targets + same intermediates), edges and the `gap %` recompute, and the graph stays consistent (no mixed-dimension vectors / no crash).
3. Paste one comparison: the same word pair's per-edge similarity % under each model (MiniLM vs Numberbatch).

- [ ] **Step 7: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "test: verify model picker end-to-end"
```

---

## Self-Review Notes

- **Spec coverage:** curated vocab (Task 1) ✓; regenerated `dictionary.json` (Task 1) ✓; reconciled `nouns.ts` (Task 2) ✓; committed build script printing vocab size/bytes/dropped words (Task 1) ✓; `public/numberbatch.bin` + `numberbatch-index.json` int8 N×300 / `{dim,words}` (Task 1) ✓; `models.ts` registry (Task 4) ✓; `createEmbeddings(modelId)` selecting the right worker (Task 5) ✓; MiniLM worker kept, new `numberbatch.worker.ts` with progress→ready, Map<word,row>, dequantized normalized Float32Array(300) (Tasks 3,6) ✓; cache key includes model id (Task 5) ✓; `<select>` in Hud + localStorage default `numberbatch` (Tasks 8,9) ✓; switch tears down old worker, re-embeds graph, recomputes edges/gap, shows progress, reuses same puzzle (Tasks 7,9) ✓; tests for cache namespace + 300-dim normalized lookup (Tasks 3,5) ✓; verify steps (Task 10) ✓; named constants TOP_N/QUANT_SCALE/DIM/DEFAULT_MODEL (Tasks 1,3,4) ✓.
- **Constraints:** no backend (assets static + HF CDN) ✓; engine/math untouched ✓; `@huggingface/transformers` stays a dependency ✓.
- **Type consistency:** `setEmbedder`/`reEmbedCurrent`, `EmbeddingsHandle.destroy()`/`modelId`, `cacheKey(modelId, word)`, `ModelId`, `MODEL_LIST`, `DEFAULT_MODEL`, `dequantize`/`buildIndex`/`lookup`/`NUMBERBATCH_QUANT_SCALE` are defined once and referenced with matching names/signatures across tasks.
- **Quantization parity:** `QUANT_SCALE = 127` is duplicated in `scripts/build-vectors.py` and `src/lib/numberbatch.ts` (`NUMBERBATCH_QUANT_SCALE`) with cross-reference comments — the one intentional duplication, since the script is Python and the runtime is TS.
