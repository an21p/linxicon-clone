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
