// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { VectorTable, QUANT_SCALE } from '../../server/vectorTable';
import { createService } from '../../server/embeddings';
import { buildApp } from '../../server/app';

function svc() {
  const nb = (() => { const m = new Int8Array(300); m[0] = QUANT_SCALE; return new VectorTable(m, ['cow'], 300); })();
  const ml = (() => { const m = new Int8Array(384); m[0] = QUANT_SCALE; return new VectorTable(m, ['cow'], 384); })();
  return createService({
    numberbatch: nb, minilm: ml,
    minilmLive: vi.fn(async () => new Float32Array(384).fill(0.05)),
    dictionary: new Set(['cow']),
  });
}

// A tiny 2-D world where 'mid' sits between anchors 'a' and 'b' — for the hint route.
function hintSvc() {
  const dim = 2;
  const words = ['a', 'b', 'mid'];
  const m = new Int8Array(words.length * dim);
  m[0 * dim + 0] = QUANT_SCALE;                                                                   // a = (1,0)
  m[1 * dim + 1] = QUANT_SCALE;                                                                   // b = (0,1)
  m[2 * dim + 0] = Math.round(0.7 * QUANT_SCALE); m[2 * dim + 1] = Math.round(0.7 * QUANT_SCALE); // mid
  const nb = new VectorTable(m, words, dim);
  const ml = new VectorTable(new Int8Array(384), ['cow'], 384);
  return createService({ numberbatch: nb, minilm: ml, minilmLive: vi.fn(), dictionary: new Set(['mid']) });
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

  it('POST /api/embed rejects an over-long word with 400 (DoS guard)', async () => {
    const app = await buildApp({ service: svc() });
    const res = await app.inject({
      method: 'POST', url: '/api/embed',
      payload: { model: 'minilm', words: ['a'.repeat(201)] },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('POST /api/hint returns the best bridging word', async () => {
    const app = await buildApp({ service: hintSvc() });
    const res = await app.inject({
      method: 'POST', url: '/api/hint',
      payload: { model: 'numberbatch', a: 'a', b: 'b', exclude: [] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().word).toBe('mid');
    await app.close();
  });

  it('POST /api/hint rejects a bad model with 400', async () => {
    const app = await buildApp({ service: hintSvc() });
    const res = await app.inject({
      method: 'POST', url: '/api/hint',
      payload: { model: 'x', a: 'a', b: 'b' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
