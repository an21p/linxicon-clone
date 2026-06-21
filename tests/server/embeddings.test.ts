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
    const svc = createService({ numberbatch, minilm, minilmLive: live, dictionary: new Set(['cow']) });
    expect(svc.dim('numberbatch')).toBe(300);
    const out = await svc.embed('numberbatch', ['cow']);
    expect(out[0]!.length).toBe(300);
    expect(live).not.toHaveBeenCalled();
  });

  it('numberbatch miss yields null; minilm miss hits live inference', async () => {
    const liveVec = new Float32Array(384).fill(0.1);
    const live = vi.fn(async () => liveVec);
    const svc = createService({ numberbatch, minilm, minilmLive: live, dictionary: new Set(['cow']) });

    expect(await svc.embed('numberbatch', ['nope'])).toEqual([null]);

    const out = await svc.embed('minilm', ['nope']);
    expect(live).toHaveBeenCalledWith('nope');
    expect(out[0]!.length).toBe(384);
  });

  it('normalizes word casing/whitespace before lookup', async () => {
    const svc = createService({ numberbatch, minilm, minilmLive: vi.fn(), dictionary: new Set(['cow']) });
    const out = await svc.embed('numberbatch', ['  COW ']);
    expect(out[0]).not.toBeNull();
  });

  it('hint picks the dictionary word most similar to both anchors', async () => {
    // 2-D vectors: anchors at the axes, candidates between them. 'mid' (45°) is
    // closest to BOTH; 'nearA' leans to A; 'off' is excluded though it scores well.
    const dim = 2;
    const words = ['a', 'b', 'mid', 'nearA', 'off'];
    const m = new Int8Array(words.length * dim);
    const set = (w: string, x: number, y: number) => {
      m[words.indexOf(w) * dim + 0] = Math.round(x * QUANT_SCALE);
      m[words.indexOf(w) * dim + 1] = Math.round(y * QUANT_SCALE);
    };
    set('a', 1, 0); set('b', 0, 1); set('mid', 0.7, 0.7); set('nearA', 0.97, 0.24); set('off', 0.6, 0.8);
    const nb = new VectorTable(m, words, dim);
    const svc = createService({
      numberbatch: nb, minilm, minilmLive: vi.fn(),
      dictionary: new Set(['mid', 'nearA', 'off']),
    });

    const hit = await svc.hint('numberbatch', 'a', 'b', ['off']);
    expect(hit?.word).toBe('mid');
    expect(hit!.score).toBeGreaterThan(0);
  });

  it('hint returns null when an anchor has no vector', async () => {
    const svc = createService({ numberbatch, minilm, minilmLive: vi.fn(), dictionary: new Set(['cow']) });
    expect(await svc.hint('numberbatch', 'ghost', 'cow', [])).toBeNull();
  });
});
