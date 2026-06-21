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
    expect(v[0]).toBeCloseTo(0.6, 5); // Float32 can't represent 0.6/0.8 exactly
    expect(v[1]).toBeCloseTo(0.8, 5);
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

  it('onReady still fires when registered after the health check resolves (latched)', async () => {
    const h = createEmbeddings('minilm');
    await new Promise((r) => setTimeout(r, 0)); // let the health fetch resolve first
    const ready = await new Promise<boolean>((resolve) => h.onReady(() => resolve(true)));
    expect(ready).toBe(true);
  });
});
