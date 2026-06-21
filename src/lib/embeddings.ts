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
