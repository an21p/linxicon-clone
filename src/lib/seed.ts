// Deterministic daily puzzle seed: same (day, count) -> same words across reloads.

const DAY_MS = 86_400_000;

/** UTC day index (days since the Unix epoch). */
export function todayNumber(now: number = Date.now()): number {
  return Math.floor(now / DAY_MS);
}

/** mulberry32 — a tiny, fast, deterministic PRNG returning values in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Reproducible RNG for a given (day, count) seed. */
export function seededRng(day: number, count: number): () => number {
  const seed = (Math.imul(day, 0x9e3779b1) ^ Math.imul(count + 1, 0x85ebca77)) >>> 0;
  return mulberry32(seed);
}

export interface Seed {
  day: number;
  count: number;
}

/** Minimal subset of the Storage API, injectable for tests. */
export interface SeedStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const SEED_STORAGE_KEY = 'linxicon.seed';

/** URL query param carrying the puzzle number (the seed's `count`). */
export const PUZZLE_PARAM = 'puzzle';

/**
 * Parse the puzzle number from a query string (e.g. `?puzzle=5`). Returns a
 * non-negative integer, or null when the param is absent or malformed.
 */
export function puzzleFromQuery(search: string): number | null {
  const raw = new URLSearchParams(search).get(PUZZLE_PARAM);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * Current seed for today. The puzzle number (`count`) is taken from the
 * `?puzzle=N` query param when present and valid; otherwise it falls back to
 * the stored seed (or today's first puzzle, count 0). The day is always today.
 * The resolved seed is persisted so reloads without the param stay stable.
 */
export function loadSeed(
  store: SeedStore = localStorage,
  now: number = Date.now(),
  search = '',
): Seed {
  const today = todayNumber(now);

  const fromUrl = puzzleFromQuery(search);
  if (fromUrl !== null) {
    const seed: Seed = { day: today, count: fromUrl };
    store.setItem(SEED_STORAGE_KEY, JSON.stringify(seed));
    return seed;
  }

  let parsed: Partial<Seed> | null = null;
  try {
    const raw = store.getItem(SEED_STORAGE_KEY);
    parsed = raw ? (JSON.parse(raw) as Partial<Seed>) : null;
  } catch {
    parsed = null;
  }
  if (
    !parsed ||
    typeof parsed.day !== 'number' ||
    typeof parsed.count !== 'number' ||
    parsed.day !== today
  ) {
    const fresh: Seed = { day: today, count: 0 };
    store.setItem(SEED_STORAGE_KEY, JSON.stringify(fresh));
    return fresh;
  }
  return { day: parsed.day, count: parsed.count };
}

/** Advance to the next puzzle: a new UTC day resets to count 0, otherwise count + 1. */
export function advanceSeed(store: SeedStore = localStorage, now: number = Date.now()): Seed {
  const current = loadSeed(store, now); // normalizes the day first
  const next: Seed = { day: current.day, count: current.count + 1 };
  store.setItem(SEED_STORAGE_KEY, JSON.stringify(next));
  return next;
}
