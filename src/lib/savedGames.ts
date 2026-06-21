// Persist the words placed in each puzzle so navigating between games — or
// reloading — restores the board instead of losing it. Only the word strings are
// stored; their vectors are re-embedded on restore (and cached in IndexedDB), and
// edges are model/threshold-dependent so they're never persisted.

export interface GamesStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY = 'linxicon.games';

/** Stable per-puzzle key. Words are model-independent, so the model is not part of it. */
export function puzzleKey(day: number, count: number): string {
  return `${day}:${count}`;
}

export function loadGames(store: GamesStore): Record<string, string[]> {
  try {
    const parsed = JSON.parse(store.getItem(STORAGE_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === 'string');
    }
    return out;
  } catch {
    return {};
  }
}

export function loadWords(store: GamesStore, key: string): string[] {
  return loadGames(store)[key] ?? [];
}

export function saveWords(store: GamesStore, key: string, words: string[]): void {
  const games = loadGames(store);
  if (words.length === 0) delete games[key];
  else games[key] = words;
  store.setItem(STORAGE_KEY, JSON.stringify(games));
}
