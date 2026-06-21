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
