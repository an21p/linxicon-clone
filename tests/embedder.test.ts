import { describe, it, expect, vi } from 'vitest';
import { withCache } from '../src/lib/embedder';

describe('withCache', () => {
  it('calls the underlying embedFn once per unique word', async () => {
    const fn = vi.fn(async (w: string) => new Float32Array([w.length]));
    const e = withCache(fn);
    await e.embed('cow');
    await e.embed('cow');
    await e.embed('milk');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('normalizes case before caching', async () => {
    const fn = vi.fn(async () => new Float32Array([1]));
    const e = withCache(fn);
    await e.embed('Cow');
    await e.embed('cow');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('reads from a persistent store before calling embedFn', async () => {
    const fn = vi.fn(async () => new Float32Array([9]));
    const store = {
      get: vi.fn(async () => new Float32Array([7])),
      set: vi.fn(async () => {}),
    };
    const e = withCache(fn, store);
    const v = await e.embed('cat');
    expect(Array.from(v)).toEqual([7]);
    expect(fn).not.toHaveBeenCalled();
  });
});
