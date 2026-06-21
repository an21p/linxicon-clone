import { describe, it, expect } from 'vitest';
import { puzzleKey, loadGames, loadWords, saveWords, type GamesStore } from '../src/lib/savedGames';

function fakeStore(initial?: string): GamesStore & { value: string | null } {
  return {
    value: initial ?? null,
    getItem() { return this.value; },
    setItem(_k, v) { this.value = v; },
  };
}

describe('savedGames', () => {
  it('puzzleKey combines day and count, independent of model', () => {
    expect(puzzleKey(20000, 3)).toBe('20000:3');
  });

  it('round-trips words for a puzzle key', () => {
    const s = fakeStore();
    saveWords(s, '1:2', ['river', 'sea']);
    expect(loadWords(s, '1:2')).toEqual(['river', 'sea']);
  });

  it('keeps games for different keys separate', () => {
    const s = fakeStore();
    saveWords(s, '1:1', ['a']);
    saveWords(s, '1:2', ['b', 'c']);
    expect(loadWords(s, '1:1')).toEqual(['a']);
    expect(loadWords(s, '1:2')).toEqual(['b', 'c']);
  });

  it('saving an empty list removes the entry', () => {
    const s = fakeStore();
    saveWords(s, '1:1', ['a']);
    saveWords(s, '1:1', []);
    expect(loadGames(s)).toEqual({});
  });

  it('returns no words for an unknown key', () => {
    expect(loadWords(fakeStore(), 'nope')).toEqual([]);
  });

  it('tolerates malformed storage', () => {
    expect(loadGames(fakeStore('not json'))).toEqual({});
    expect(loadWords(fakeStore('not json'), '1:1')).toEqual([]);
  });

  it('filters non-string entries defensively', () => {
    const s = fakeStore(JSON.stringify({ '1:1': ['ok', 3, null, 'fine'] }));
    expect(loadWords(s, '1:1')).toEqual(['ok', 'fine']);
  });
});
