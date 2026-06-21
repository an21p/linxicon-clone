import { describe, it, expect } from 'vitest';
import {
  todayNumber,
  mulberry32,
  seededRng,
  loadSeed,
  advanceSeed,
  SEED_STORAGE_KEY,
  type SeedStore,
} from '../src/lib/seed';

const DAY = 86_400_000;

function fakeStore(initial?: string): SeedStore & { value: string | null } {
  return {
    value: initial ?? null,
    getItem(_k) { return this.value; },
    setItem(_k, v) { this.value = v; },
  };
}

describe('seed', () => {
  it('todayNumber is the UTC day index for a timestamp', () => {
    expect(todayNumber(0)).toBe(0);
    expect(todayNumber(DAY * 20000 + 123)).toBe(20000);
  });

  it('mulberry32 is deterministic for a given seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect(a()).toBe(b());
    expect(a()).toBe(b());
    expect(mulberry32(42)()).not.toBe(mulberry32(43)());
  });

  it('seededRng reproduces the same sequence for the same (day,count)', () => {
    const r1 = seededRng(20000, 0);
    const r2 = seededRng(20000, 0);
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()]);
    expect(seededRng(20000, 0)()).not.toBe(seededRng(20000, 1)());
  });

  it('loadSeed returns today/0 and persists when storage is empty', () => {
    const store = fakeStore();
    const now = DAY * 20000;
    expect(loadSeed(store, now)).toEqual({ day: 20000, count: 0 });
    expect(JSON.parse(store.value!)).toEqual({ day: 20000, count: 0 });
  });

  it('loadSeed keeps a stored seed from the same day (stable across reloads)', () => {
    const store = fakeStore(JSON.stringify({ day: 20000, count: 3 }));
    const now = DAY * 20000 + 5000;
    expect(loadSeed(store, now)).toEqual({ day: 20000, count: 3 });
  });

  it('loadSeed resets to count 0 on a new day', () => {
    const store = fakeStore(JSON.stringify({ day: 20000, count: 3 }));
    const now = DAY * 20001;
    expect(loadSeed(store, now)).toEqual({ day: 20001, count: 0 });
  });

  it('advanceSeed increments count within the same day and persists', () => {
    const store = fakeStore(JSON.stringify({ day: 20000, count: 3 }));
    const now = DAY * 20000;
    expect(advanceSeed(store, now)).toEqual({ day: 20000, count: 4 });
    expect(JSON.parse(store.value!)).toEqual({ day: 20000, count: 4 });
    expect(store.getItem(SEED_STORAGE_KEY)).toBeTruthy();
  });
});
