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
