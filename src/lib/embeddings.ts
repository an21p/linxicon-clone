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
  void fetch(`${API_BASE}/health`, { signal: ctrl.signal }).then(res => {
    if (!res.ok) throw new Error(`health ${res.status}`);
    progressCb?.(100);
    readyCb?.();
  }).catch((err: unknown) => {
    if ((err as Error).name !== 'AbortError') {
      errorCb?.('Could not reach the word service.');
    }
  });

  return {
    modelId,
    embedder: withCache(embedFn, store),
    onProgress(cb) { progressCb = cb; },
    onReady(cb) { readyCb = cb; },
    onError(cb) { errorCb = cb; },
    destroy() { ctrl.abort(); },
  };
}
