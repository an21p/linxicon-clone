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
