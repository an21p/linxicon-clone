# Server-Side Embeddings API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the in-browser embedding web workers with a single Node (Fastify) embeddings API that holds precomputed vector lookup tables (MiniLM + Numberbatch) plus a live MiniLM fallback, served single-origin so the cloudflared tunnel exposes one host.

**Architecture:** A `server/` Fastify service loads two committed int8 lookup tables from `data/` into memory and answers `POST /api/embed`; MiniLM misses fall back to live `@huggingface/transformers` inference (model loaded once, server-side). The browser's `createEmbeddings(modelId)` becomes an HTTP embedder (no worker, no model/matrix download) keeping the `Embedder` interface, `withCache`, and model-namespaced cache intact. In dev Vite proxies `/api` → Node; in prod Node serves `dist/` + `/api`.

**Tech Stack:** Node 24 (ESM), TypeScript via `tsx`, Fastify + `@fastify/static`, `@huggingface/transformers` (server-side), Vite, Vitest. Design: `docs/superpowers/specs/2026-06-21-embeddings-api-design.md`.

---

## Established Facts (verified)

- Branch `feature/embeddings-api` is checked out off `main`.
- `package.json`: `"type": "module"`; deps include `@huggingface/transformers@^4.2.0`, `idb-keyval`; devDeps include `vitest`, `svelte-check`, `typescript`. Scripts: `dev`, `build`, `preview`, `check` (`svelte-check --tsconfig ./tsconfig.app.json && tsc -p tsconfig.node.json`), `test` (`vitest run`).
- `vite.config.ts` currently: `server.allowedHosts: true`, `test.environment: 'jsdom'`, `worker: { format: 'es' }`.
- `src/lib/models.ts` exports `type ModelId = 'minilm'|'numberbatch'`, `MODELS`, `isModelId`, `DEFAULT_MODEL`.
- `src/lib/embedder.ts` exports `withCache(embedFn, store)` returning `{ embed(word) }`, normalizing `word.trim().toLowerCase()`; `Embedder` and `PersistentStore` interfaces.
- Current `src/lib/embeddings.ts` exports `cacheKey(modelId, word)` (`vec:${modelId}:${word}`), `createEmbeddings(modelId)` returning `{ modelId, embedder, onProgress, onReady, onError, destroy }`. `App.svelte` consumes exactly those members; `game.ts` is embedder-transport-agnostic.
- Committed assets: `public/numberbatch.bin` (int8 33114×300, 9.9 MB) + `public/numberbatch-index.json` (`{dim:300, words:[...]}`, words == `src/lib/words/dictionary.json`, 33,114 entries).
- `scripts/build-vectors.py` writes `BIN_PATH = public/numberbatch.bin`, `INDEX_PATH = public/numberbatch-index.json`; quant `clip(round(v*127),-127,127)`, `QUANT_SCALE=127`, row-major.
- Existing tests: `tests/{dictionary,embedder,engine,game,math,puzzles}.test.ts`, `tests/embeddings-cache.test.ts` (imports `cacheKey`), `tests/numberbatch.test.ts` (imports `src/lib/numberbatch`). Vitest `include: tests/**/*.test.ts`, jsdom default.

## Named Constants

- `QUANT_SCALE = 127` — duplicated in `scripts/build-vectors.py`, `scripts/build-minilm.mjs`, and `server/vectorTable.ts` (cross-referenced comments). Must match.
- `MINILM_DIM = 384`, `NUMBERBATCH_DIM = 300` — already in `src/lib/models.ts`.
- API port `8787` (override `PORT`); API base `'/api'`.

## File Structure

- Create `data/` — committed, non-served vector tables: `numberbatch.bin`/`numberbatch-index.json` (moved from `public/`), `minilm.bin`/`minilm-index.json` (new).
- Create `scripts/build-minilm.mjs` — offline MiniLM table generation (Node + transformers).
- Modify `scripts/build-vectors.py` — output to `data/` instead of `public/`.
- Create `server/vectorTable.ts` — int8 table load + dequantize/normalize lookup.
- Create `server/embeddings.ts` — model→table routing + MiniLM live fallback (deps injected).
- Create `server/minilm.ts` — real live inference (lazy pipeline, memoized).
- Create `server/app.ts` — `buildApp(deps)` → Fastify with `/api/embed`, `/api/health`, optional static.
- Create `server/index.ts` — entrypoint: load tables, wire live, listen, serve `dist/` in prod.
- Create `tsconfig.server.json` — type-checks `server/**`.
- Modify `src/lib/embeddings.ts` — HTTP embedder (keep `cacheKey`, handle shape).
- Delete `src/lib/embeddings.worker.ts`, `src/lib/numberbatch.worker.ts`, `src/lib/numberbatch.ts`, `tests/numberbatch.test.ts`.
- Modify `vite.config.ts` — add `server.proxy['/api']`, remove `worker` config.
- Modify `package.json` — deps + scripts.
- Tests: `tests/server/vectorTable.test.ts`, `tests/server/embed-route.test.ts`, `tests/embeddings-http.test.ts`.

---

### Task 1: Dependencies, server tsconfig, and npm scripts

**Files:** Modify `package.json`; Create `tsconfig.server.json`.

- [ ] **Step 1: Install dependencies**

Run:
```bash
cd /Users/pishias/code/linxicon2
npm install fastify @fastify/static
npm install -D tsx
```
Expected: installs succeed; `fastify` + `@fastify/static` in `dependencies`, `tsx` in `devDependencies`.

- [ ] **Step 2: Create `tsconfig.server.json`** with EXACTLY:

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.server.tsbuildinfo",
    "target": "es2023",
    "lib": ["ES2023"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "types": ["node"],
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "resolveJsonModule": true
  },
  "include": ["server/**/*.ts"]
}
```

- [ ] **Step 3: Update `package.json` scripts**

Replace the `"scripts"` block with:

```json
  "scripts": {
    "dev": "vite",
    "dev:api": "tsx watch server/index.ts",
    "serve": "vite build && NODE_ENV=production tsx server/index.ts",
    "build": "vite build",
    "preview": "vite preview",
    "build:vectors:minilm": "node scripts/build-minilm.mjs",
    "check": "svelte-check --tsconfig ./tsconfig.app.json && tsc -p tsconfig.node.json",
    "test": "vitest run",
    "test:watch": "vitest"
  },
```

(The server type-check is added to `check` in Task 3, once `server/**` has its first file — appending it now would make `tsc -p tsconfig.server.json` fail with "No inputs were found".)

- [ ] **Step 4: Verify install + existing checks still pass**

Run: `npm run check`
Expected: clean (unchanged behavior — server tsc not yet wired in).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.server.json
git commit -m "chore: add server deps (fastify, tsx), server tsconfig, api scripts"
```

---

### Task 2: Relocate vector tables to `data/` and generate the MiniLM table

**Files:** Modify `scripts/build-vectors.py`; Create `scripts/build-minilm.mjs`; move `public/numberbatch.*` → `data/`; create `data/minilm.*`.

- [ ] **Step 1: Move the Numberbatch assets to `data/`**

Run:
```bash
mkdir -p data
git mv public/numberbatch.bin data/numberbatch.bin
git mv public/numberbatch-index.json data/numberbatch-index.json
```
Expected: both files now under `data/`.

- [ ] **Step 2: Point `build-vectors.py` at `data/`**

In `scripts/build-vectors.py`, replace:
```python
BIN_PATH = os.path.join(ROOT, "public", "numberbatch.bin")
INDEX_PATH = os.path.join(ROOT, "public", "numberbatch-index.json")
```
with:
```python
BIN_PATH = os.path.join(ROOT, "data", "numberbatch.bin")
INDEX_PATH = os.path.join(ROOT, "data", "numberbatch-index.json")
```
And in `main()`, immediately before the `# --- write assets ---` block, add:
```python
    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
```

- [ ] **Step 3: Create `scripts/build-minilm.mjs`** with EXACTLY:

```javascript
// Offline MiniLM table generation. Run: node scripts/build-minilm.mjs
// Emits data/minilm.bin (int8 N x 384) + data/minilm-index.json.
// QUANT_SCALE must match server/vectorTable.ts and scripts/build-vectors.py (127).
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline, env } from '@huggingface/transformers';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUANT_SCALE = 127;
const DIM = 384;

env.allowLocalModels = false;

const words = JSON.parse(readFileSync(join(ROOT, 'src/lib/words/dictionary.json'), 'utf8'));
const n = words.length;
console.log(`embedding ${n} words with all-MiniLM-L6-v2 (this takes several minutes)…`);

const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
const mat = new Int8Array(n * DIM);

for (let i = 0; i < n; i++) {
  const out = await extractor(words[i], { pooling: 'mean', normalize: true });
  const v = out.data; // Float32Array length 384 (already normalized)
  let norm = 0;
  for (let k = 0; k < DIM; k++) norm += v[k] * v[k];
  norm = Math.sqrt(norm) || 1;
  for (let k = 0; k < DIM; k++) {
    let q = Math.round((v[k] / norm) * QUANT_SCALE);
    if (q > QUANT_SCALE) q = QUANT_SCALE;
    if (q < -QUANT_SCALE) q = -QUANT_SCALE;
    mat[i * DIM + k] = q;
  }
  if (i % 2000 === 0) console.log(`  ${i}/${n}`);
}

mkdirSync(join(ROOT, 'data'), { recursive: true });
writeFileSync(join(ROOT, 'data/minilm.bin'), Buffer.from(mat.buffer));
writeFileSync(join(ROOT, 'data/minilm-index.json'), JSON.stringify({ dim: DIM, words }));
console.log(`vocab ${n} · minilm.bin ${statSync(join(ROOT, 'data/minilm.bin')).size} bytes`);
```

- [ ] **Step 4: Generate the MiniLM table**

Run: `npm run build:vectors:minilm`
Expected: progress logs, then `vocab 33114 · minilm.bin 12715776 bytes` (33114×384). May take several minutes (downloads the model once, then embeds 33,114 words).

- [ ] **Step 5: Verify table integrity**

Run:
```bash
node -e "const fs=require('fs');const ix=JSON.parse(fs.readFileSync('data/minilm-index.json'));const n=ix.words.length;const b=fs.statSync('data/minilm.bin').size;const d=JSON.parse(fs.readFileSync('src/lib/words/dictionary.json'));console.log('dim',ix.dim,'n',n,'bin',b,'expected',n*384,'wordsMatchDict',JSON.stringify(ix.words)===JSON.stringify(d))"
```
Expected: `dim 384 n 33114 bin 12715776 expected 12715776 wordsMatchDict true`.

- [ ] **Step 6: Commit**

```bash
git add scripts/build-vectors.py scripts/build-minilm.mjs data/numberbatch.bin data/numberbatch-index.json data/minilm.bin data/minilm-index.json
git commit -m "feat: relocate vector tables to data/ and build MiniLM table"
```

---

### Task 3: `VectorTable` — int8 lookup with dequantize/normalize (TDD)

**Files:** Create `server/vectorTable.ts`; Test `tests/server/vectorTable.test.ts`.

- [ ] **Step 1: Write the failing test** — Create `tests/server/vectorTable.test.ts` with EXACTLY:

```typescript
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { VectorTable, QUANT_SCALE } from '../../server/vectorTable';

describe('VectorTable', () => {
  it('lookup returns a unit-norm Float32Array of the table dim for a known word', () => {
    const dim = 3;
    const words = ['cat', 'cow'];
    const matrix = new Int8Array(words.length * dim);
    matrix[1 * dim + 0] = QUANT_SCALE; // cow -> [1,0,0] after normalize
    const t = new VectorTable(matrix, words, dim);
    const v = t.lookup('cow');
    expect(v).not.toBeNull();
    expect(v!.length).toBe(3);
    expect(Math.hypot(...v!)).toBeCloseTo(1, 5);
    expect(v![0]).toBeCloseTo(1, 5);
  });

  it('lookup returns null for an unknown word', () => {
    const t = new VectorTable(new Int8Array(3), ['cat'], 3);
    expect(t.lookup('zzz')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/server/vectorTable.test.ts` → FAIL (cannot resolve `../../server/vectorTable`).

- [ ] **Step 3: Create `server/vectorTable.ts`** with EXACTLY:

```typescript
import { readFileSync } from 'node:fs';

// Must match scripts/build-vectors.py and scripts/build-minilm.mjs (127).
export const QUANT_SCALE = 127;

export interface TableIndex {
  dim: number;
  words: string[];
}

export class VectorTable {
  readonly dim: number;
  private readonly matrix: Int8Array;
  private readonly rowOf: Map<string, number>;

  constructor(matrix: Int8Array, words: string[], dim: number) {
    this.dim = dim;
    this.matrix = matrix;
    this.rowOf = new Map(words.map((w, i) => [w, i]));
  }

  static fromFiles(binPath: string, indexPath: string): VectorTable {
    const index = JSON.parse(readFileSync(indexPath, 'utf8')) as TableIndex;
    const buf = readFileSync(binPath);
    const matrix = new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const expected = index.words.length * index.dim;
    if (matrix.length !== expected) {
      throw new Error(`table size mismatch: ${matrix.length} != ${expected} (${binPath})`);
    }
    return new VectorTable(matrix, index.words, index.dim);
  }

  /** Dequantized (÷127), L2-normalized vector for `word`, or null if absent. */
  lookup(word: string): Float32Array | null {
    const row = this.rowOf.get(word);
    if (row === undefined) return null;
    const dim = this.dim;
    const out = new Float32Array(dim);
    let n = 0;
    for (let i = 0; i < dim; i++) {
      const v = this.matrix[row * dim + i] / QUANT_SCALE;
      out[i] = v;
      n += v * v;
    }
    n = Math.sqrt(n);
    if (n > 0) for (let i = 0; i < dim; i++) out[i] /= n;
    return out;
  }
}
```

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run tests/server/vectorTable.test.ts` → PASS (2 tests).

- [ ] **Step 5: Wire the server type-check into `check`**

Now that `server/**` has a file, update `package.json`'s `check` script to:
```json
    "check": "svelte-check --tsconfig ./tsconfig.app.json && tsc -p tsconfig.node.json && tsc -p tsconfig.server.json",
```
Run: `npm run check`
Expected: clean (server tsconfig now has inputs and type-checks).

- [ ] **Step 6: Commit**

```bash
git add server/vectorTable.ts tests/server/vectorTable.test.ts package.json
git commit -m "feat: server VectorTable int8 lookup with tests"
```

---

### Task 4: Embeddings service — table routing + MiniLM live fallback (TDD)

**Files:** Create `server/embeddings.ts`; Test `tests/server/embed-route.test.ts` (route test added in Task 6 reuses this; here test the service directly).

- [ ] **Step 1: Write the failing test** — Create `tests/server/embeddings.test.ts` with EXACTLY:

```typescript
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { VectorTable, QUANT_SCALE } from '../../server/vectorTable';
import { createService } from '../../server/embeddings';

function table(words: string[], dim: number, fill: Record<string, number>) {
  const m = new Int8Array(words.length * dim);
  for (const [w, col] of Object.entries(fill)) m[words.indexOf(w) * dim + 0] = col;
  return new VectorTable(m, words, dim);
}

describe('createService', () => {
  const numberbatch = table(['cow'], 300, { cow: QUANT_SCALE });
  const minilm = table(['cow'], 384, { cow: QUANT_SCALE });

  it('returns dim and looked-up vectors in word order', async () => {
    const live = vi.fn(async () => new Float32Array(384));
    const svc = createService({ numberbatch, minilm, minilmLive: live });
    expect(svc.dim('numberbatch')).toBe(300);
    const out = await svc.embed('numberbatch', ['cow']);
    expect(out[0]!.length).toBe(300);
    expect(live).not.toHaveBeenCalled();
  });

  it('numberbatch miss yields null; minilm miss hits live inference', async () => {
    const liveVec = new Float32Array(384).fill(0.1);
    const live = vi.fn(async () => liveVec);
    const svc = createService({ numberbatch, minilm, minilmLive: live });

    expect(await svc.embed('numberbatch', ['nope'])).toEqual([null]);

    const out = await svc.embed('minilm', ['nope']);
    expect(live).toHaveBeenCalledWith('nope');
    expect(out[0]!.length).toBe(384);
  });

  it('normalizes word casing/whitespace before lookup', async () => {
    const svc = createService({ numberbatch, minilm, minilmLive: vi.fn() });
    const out = await svc.embed('numberbatch', ['  COW ']);
    expect(out[0]).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/server/embeddings.test.ts` → FAIL (cannot resolve `../../server/embeddings`).

- [ ] **Step 3: Create `server/embeddings.ts`** with EXACTLY:

```typescript
import type { VectorTable } from './vectorTable';
import type { ModelId } from '../src/lib/models';

export type LiveEmbed = (word: string) => Promise<Float32Array>;

export interface ServiceDeps {
  numberbatch: VectorTable;
  minilm: VectorTable;
  minilmLive: LiveEmbed; // fallback for words not in the MiniLM table
}

export interface EmbeddingsService {
  dim(model: ModelId): number;
  embed(model: ModelId, words: string[]): Promise<(number[] | null)[]>;
}

export function createService(deps: ServiceDeps): EmbeddingsService {
  const tableFor = (model: ModelId): VectorTable =>
    model === 'numberbatch' ? deps.numberbatch : deps.minilm;

  return {
    dim(model) {
      return tableFor(model).dim;
    },
    async embed(model, words) {
      const t = tableFor(model);
      const out: (number[] | null)[] = [];
      for (const raw of words) {
        const word = raw.trim().toLowerCase();
        const hit = t.lookup(word);
        if (hit) {
          out.push(Array.from(hit));
        } else if (model === 'minilm') {
          out.push(Array.from(await deps.minilmLive(word)));
        } else {
          out.push(null);
        }
      }
      return out;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run tests/server/embeddings.test.ts` → PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/embeddings.ts tests/server/embeddings.test.ts
git commit -m "feat: server embeddings service (table routing + live fallback)"
```

---

### Task 5: Live MiniLM inference module

**Files:** Create `server/minilm.ts`.

- [ ] **Step 1: Create `server/minilm.ts`** with EXACTLY:

```typescript
import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers';
import type { LiveEmbed } from './embeddings';

env.allowLocalModels = false; // fetch from the HF hub / CDN, server-side, once

/** Lazily-loaded, memoized MiniLM live embedder for non-curated words. */
export function createMinilmLive(): LiveEmbed {
  let pipe: Promise<FeatureExtractionPipeline> | null = null;
  const memo = new Map<string, Float32Array>();
  return async (word: string): Promise<Float32Array> => {
    const cached = memo.get(word);
    if (cached) return cached;
    if (!pipe) pipe = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    const ex = await pipe;
    const out = await ex(word, { pooling: 'mean', normalize: true });
    const v = Float32Array.from(out.data as Float32Array);
    memo.set(word, v);
    return v;
  };
}
```

- [ ] **Step 2: Type-check** — Run: `tsc -p tsconfig.server.json`
Expected: no errors referencing `server/minilm.ts`.

- [ ] **Step 3: Commit**

```bash
git add server/minilm.ts
git commit -m "feat: lazy memoized live MiniLM inference"
```

---

### Task 6: Fastify app — `/api/embed` and `/api/health` (TDD)

**Files:** Create `server/app.ts`; Create `tests/server/embed-route.test.ts`.

- [ ] **Step 1: Write the failing test** — Create `tests/server/embed-route.test.ts` with EXACTLY:

```typescript
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { VectorTable, QUANT_SCALE } from '../../server/vectorTable';
import { createService } from '../../server/embeddings';
import { buildApp } from '../../server/app';

function svc() {
  const nb = (() => { const m = new Int8Array(300); m[0] = QUANT_SCALE; return new VectorTable(m, ['cow'], 300); })();
  const ml = (() => { const m = new Int8Array(384); m[0] = QUANT_SCALE; return new VectorTable(m, ['cow'], 384); })();
  return createService({ numberbatch: nb, minilm: ml, minilmLive: vi.fn(async () => new Float32Array(384).fill(0.05)) });
}

describe('api', () => {
  it('GET /api/health lists models', async () => {
    const app = await buildApp({ service: svc() });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, models: ['minilm', 'numberbatch'] });
    await app.close();
  });

  it('POST /api/embed returns dim + vectors in order', async () => {
    const app = await buildApp({ service: svc() });
    const res = await app.inject({
      method: 'POST', url: '/api/embed',
      payload: { model: 'numberbatch', words: ['cow', 'nope'] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.model).toBe('numberbatch');
    expect(body.dim).toBe(300);
    expect(body.vectors[0].length).toBe(300);
    expect(body.vectors[1]).toBeNull();
    await app.close();
  });

  it('POST /api/embed rejects bad model and empty words with 400', async () => {
    const app = await buildApp({ service: svc() });
    expect((await app.inject({ method: 'POST', url: '/api/embed', payload: { model: 'x', words: ['a'] } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/embed', payload: { model: 'minilm', words: [] } })).statusCode).toBe(400);
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/server/embed-route.test.ts` → FAIL (cannot resolve `../../server/app`).

- [ ] **Step 3: Create `server/app.ts`** with EXACTLY:

```typescript
import Fastify, { type FastifyInstance } from 'fastify';
import type { EmbeddingsService } from './embeddings';
import { isModelId, MODELS } from '../src/lib/models';

export interface AppDeps {
  service: EmbeddingsService;
  staticDir?: string; // when set, serve the built site (production single-origin)
}

interface EmbedBody {
  model?: unknown;
  words?: unknown;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.get('/api/health', async () => ({ ok: true, models: Object.keys(MODELS) }));

  app.post('/api/embed', async (req, reply) => {
    const { model, words } = (req.body ?? {}) as EmbedBody;
    if (!isModelId(model)) return reply.code(400).send({ error: 'unknown model' });
    if (
      !Array.isArray(words) || words.length === 0 || words.length > 256 ||
      !words.every((w) => typeof w === 'string')
    ) {
      return reply.code(400).send({ error: 'words must be a non-empty string[] (max 256)' });
    }
    const vectors = await deps.service.embed(model, words as string[]);
    return { model, dim: deps.service.dim(model), vectors };
  });

  if (deps.staticDir) {
    const { default: fastifyStatic } = await import('@fastify/static');
    await app.register(fastifyStatic, { root: deps.staticDir });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}
```

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run tests/server/embed-route.test.ts` → PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/app.ts tests/server/embed-route.test.ts
git commit -m "feat: fastify embeddings routes with tests"
```

---

### Task 7: Server entrypoint

**Files:** Create `server/index.ts`.

- [ ] **Step 1: Create `server/index.ts`** with EXACTLY:

```typescript
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { buildApp } from './app';
import { createService } from './embeddings';
import { VectorTable } from './vectorTable';
import { createMinilmLive } from './minilm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.PORT ?? 8787);
const serveStatic = process.env.NODE_ENV === 'production' && existsSync(DIST);

const numberbatch = VectorTable.fromFiles(
  join(DATA, 'numberbatch.bin'),
  join(DATA, 'numberbatch-index.json'),
);
const minilm = VectorTable.fromFiles(
  join(DATA, 'minilm.bin'),
  join(DATA, 'minilm-index.json'),
);

const service = createService({ numberbatch, minilm, minilmLive: createMinilmLive() });
const app = await buildApp({ service, staticDir: serveStatic ? DIST : undefined });

await app.listen({ port: PORT, host: '0.0.0.0' });
console.log(`embeddings API listening on :${PORT}${serveStatic ? ' (+ static dist/)' : ''}`);
```

- [ ] **Step 2: Type-check** — Run: `tsc -p tsconfig.server.json`
Expected: clean (all of `server/**` now type-checks).

- [ ] **Step 3: Smoke-boot the server**

Run:
```bash
( npx tsx server/index.ts & echo $! > /tmp/api.pid ) ; sleep 3
curl -s localhost:8787/api/health
curl -s -X POST localhost:8787/api/embed -H 'content-type: application/json' -d '{"model":"numberbatch","words":["cow"]}' | head -c 120
kill "$(cat /tmp/api.pid)"
```
Expected: health prints `{"ok":true,"models":["minilm","numberbatch"]}`; embed prints `{"model":"numberbatch","dim":300,"vectors":[[...` (a 300-number array).

- [ ] **Step 4: Commit**

```bash
git add server/index.ts
git commit -m "feat: server entrypoint (load tables, live wiring, static in prod)"
```

---

### Task 8: Client HTTP embedder; remove workers; Vite proxy (TDD)

**Files:** Modify `src/lib/embeddings.ts`; Delete `src/lib/embeddings.worker.ts`, `src/lib/numberbatch.worker.ts`, `src/lib/numberbatch.ts`, `tests/numberbatch.test.ts`; Modify `vite.config.ts`; Create `tests/embeddings-http.test.ts`.

- [ ] **Step 1: Write the failing test** — Create `tests/embeddings-http.test.ts` with EXACTLY:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createEmbeddings, cacheKey } from '../src/lib/embeddings';

function mockFetch(embed: (body: any) => unknown) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/api/health')) {
      return { ok: true, json: async () => ({ ok: true, models: ['minilm', 'numberbatch'] }) } as Response;
    }
    const body = JSON.parse((init!.body as string));
    return { ok: true, json: async () => embed(body) } as Response;
  });
}

beforeEach(() => { vi.stubGlobal('fetch', mockFetch(() => ({ vectors: [[1, 0, 0]] }))); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('http embedder', () => {
  it('keeps model-namespaced cache keys', () => {
    expect(cacheKey('minilm', 'cow')).toBe('vec:minilm:cow');
    expect(cacheKey('numberbatch', 'cow')).not.toBe(cacheKey('minilm', 'cow'));
  });

  it('embed posts the model + word and returns a Float32Array', async () => {
    const seen: any[] = [];
    vi.stubGlobal('fetch', mockFetch((body) => { seen.push(body); return { vectors: [[0.6, 0.8]] }; }));
    const h = createEmbeddings('numberbatch');
    const v = await h.embedder.embed('cow');
    expect(v).toBeInstanceOf(Float32Array);
    expect(Array.from(v)).toEqual([0.6, 0.8]);
    expect(seen[0]).toEqual({ model: 'numberbatch', words: ['cow'] });
  });

  it('a null vector rejects', async () => {
    vi.stubGlobal('fetch', mockFetch(() => ({ vectors: [null] })));
    const h = createEmbeddings('minilm');
    await expect(h.embedder.embed('zzz')).rejects.toThrow();
  });

  it('onReady fires after a successful health check', async () => {
    const h = createEmbeddings('minilm');
    const ready = await new Promise<boolean>((resolve) => h.onReady(() => resolve(true)));
    expect(ready).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/embeddings-http.test.ts` → FAIL (current `createEmbeddings` constructs a `Worker`, not `fetch`; `onReady`/embed behavior differs).

- [ ] **Step 3: Replace the ENTIRE contents of `src/lib/embeddings.ts` with EXACTLY:**

```typescript
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { withCache, type Embedder, type PersistentStore } from './embedder';
import { DEFAULT_MODEL, type ModelId } from './models';

const API_BASE = '/api';

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

export function createEmbeddings(modelId: ModelId = DEFAULT_MODEL): EmbeddingsHandle {
  const ctrl = new AbortController();
  let progressCb: ((p: number) => void) | null = null;
  let readyCb: (() => void) | null = null;
  let errorCb: ((message: string) => void) | null = null;

  const embedFn = async (word: string): Promise<Float32Array> => {
    const res = await fetch(`${API_BASE}/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: modelId, words: [word] }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`embed ${modelId} -> ${res.status}`);
    const data = (await res.json()) as { vectors: (number[] | null)[] };
    const vec = data.vectors[0];
    if (!vec) throw new Error(`no ${modelId} vector for "${word}"`);
    return Float32Array.from(vec);
  };

  const store: PersistentStore = {
    async get(key) { return (await idbGet(cacheKey(modelId, key))) as Float32Array | undefined; },
    async set(key, value) { await idbSet(cacheKey(modelId, key), value); },
  };

  // Health check flips "ready" near-instantly — no model/matrix download in the browser.
  (async () => {
    try {
      const res = await fetch(`${API_BASE}/health`, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`health ${res.status}`);
      progressCb?.(100);
      readyCb?.();
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        errorCb?.('Could not reach the word service.');
      }
    }
  })();

  return {
    modelId,
    embedder: withCache(embedFn, store),
    onProgress(cb) { progressCb = cb; },
    onReady(cb) { readyCb = cb; },
    onError(cb) { errorCb = cb; },
    destroy() { ctrl.abort(); },
  };
}
```

- [ ] **Step 4: Delete the now-unused client model code**

Run:
```bash
git rm src/lib/embeddings.worker.ts src/lib/numberbatch.worker.ts src/lib/numberbatch.ts tests/numberbatch.test.ts
```
Expected: four files removed. (Their logic now lives in `server/`. `tests/embeddings-cache.test.ts` stays — `cacheKey` is still exported.)

- [ ] **Step 5: Update `vite.config.ts`** — replace the ENTIRE file with EXACTLY:

```typescript
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  server: {
    // allow access via the cloudflared quick-tunnel (random hostname)
    allowedHosts: true,
    // single-origin: forward API calls to the Node embeddings service
    proxy: { '/api': 'http://localhost:8787' },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts'],
    passWithNoTests: true,
  },
});
```

- [ ] **Step 6: Run tests to verify they pass** — `npx vitest run tests/embeddings-http.test.ts tests/embeddings-cache.test.ts` → PASS. Then full suite: `npx vitest run` → all PASS (the removed `tests/numberbatch.test.ts` is gone; nothing else references the deleted files).

- [ ] **Step 7: Type-check** — Run: `npm run check`
Expected: clean (client no longer imports workers/`numberbatch.ts`; `App.svelte` and `game.ts` use the unchanged handle shape).

- [ ] **Step 8: Commit**

```bash
git add src/lib/embeddings.ts vite.config.ts
git commit -m "feat: HTTP embedder replaces in-browser workers; vite /api proxy"
```

---

### Task 9: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Type-check + tests + build**

Run:
```bash
npm run check
npm test
npm run build
```
Expected: `check` clean; `npm test` all suites PASS (client + `tests/server/*`); `npm run build` succeeds. Confirm the build output no longer emits `numberbatch.worker`/`embeddings.worker` chunks, and that `dist/` does NOT contain `numberbatch.bin` (tables now live in `data/`, not `public/`). Paste the build summary.

- [ ] **Step 2: End-to-end through the API (real vectors, both models)**

Start the API, then compare the same pair under each model via the live HTTP route:
```bash
( npx tsx server/index.ts & echo $! > /tmp/api.pid ) ; sleep 3
node -e '
const base="http://localhost:8787";
const cos=(a,b)=>{let d=0,na=0,nb=0;for(let i=0;i<a.length;i++){d+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];}return d/Math.sqrt(na*nb);};
(async()=>{
  for(const model of ["minilm","numberbatch"]){
    const r=await fetch(base+"/api/embed",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({model,words:["cow","milk","nine"]})});
    const {dim,vectors:[cow,milk,nine]}=await r.json();
    console.log(model,"dim",dim,"cow-milk",(cos(cow,milk)*100).toFixed(1)+"%","cow-nine",(cos(cow,nine)*100).toFixed(1)+"%");
  }
})();'
kill "$(cat /tmp/api.pid)"
```
Expected: both models return correct dims (384 / 300); `cow-milk` high under both; `cow-nine` much lower under Numberbatch than MiniLM (mirrors the prior comparison ~24.8% vs ~1.8%). Paste the two lines.

- [ ] **Step 3: Single-origin proxy smoke (dev)**

In two shells:
```bash
npm run dev:api      # shell A — Node API on :8787
npm run dev          # shell B — Vite
```
Then confirm the proxy: `curl -s http://localhost:5173/api/health` → `{"ok":true,...}` (Vite forwards `/api` to Node). Load the app in a browser: the loading screen completes near-instantly (no model download), a puzzle appears, words score, and switching the model picker re-scores the same puzzle. Paste the `curl` output and a one-line confirmation.

- [ ] **Step 4: Production single-origin smoke**

```bash
( npm run serve & echo $! > /tmp/serve.pid ) ; sleep 6
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8787/          # built index.html
curl -s http://localhost:8787/api/health
kill "$(cat /tmp/serve.pid)"
```
Expected: `200` for `/` (Node serves `dist/`) and a healthy `/api/health` from the same origin — this is the shape the cloudflared tunnel exposes. Paste both.

---

## Self-Review Notes

- **Spec coverage:** single Node Fastify service (Tasks 6,7) ✓; `/api/embed` batch + `/api/health` (Task 6) ✓; hybrid lookup + MiniLM live fallback, Numberbatch curated-only (Task 4) ✓; committed MiniLM table via offline script (Task 2) ✓; tables in `data/` not served (Task 2) ✓; HTTP embedder keeping `Embedder`/`withCache`/`cacheKey` and handle shape, workers removed (Task 8) ✓; dev `/api` proxy + prod static single-origin (Tasks 6,7,8) ✓; vector parity (same `@huggingface/transformers` for precompute + live) (Tasks 2,5) ✓; server + client tests, engine/game untouched (Tasks 3,4,6,8) ✓.
- **Placeholder scan:** none — every code step is complete. Task 1 Step 4 notes a tolerated transient "No inputs found" only until Task 3 adds `server/**`.
- **Type consistency:** `VectorTable`/`QUANT_SCALE`, `createService`/`EmbeddingsService`/`LiveEmbed`/`ServiceDeps`, `buildApp`/`AppDeps`, `createMinilmLive`, `cacheKey`/`EmbeddingsHandle` names and signatures are defined once and used consistently. `ModelId`/`isModelId`/`MODELS` come from the unchanged `src/lib/models.ts`. The `/api/embed` response `{ model, dim, vectors }` matches the client's `data.vectors[0]` read.
- **Parity note:** the curated MiniLM path returns int8-dequantized vectors while the live fallback returns full-precision — both L2-normalized; cosine differences are negligible and only the (never-curated-miss) fallback path differs, which the game does not exercise.
