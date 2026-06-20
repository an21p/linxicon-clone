export function normalizeWord(raw: string): string | null {
  const w = raw.trim().toLowerCase();
  if (w.length === 0) return null;
  if (!/^[a-z]+(?:[-'][a-z]+)*$/.test(w)) return null; // single token, letters/hyphen/apostrophe
  return w;
}

export type ValidationResult =
  | { ok: true; word: string }
  | { ok: false; reason: 'malformed' | 'unknown' };

export function makeValidator(words: Set<string>) {
  return (raw: string): ValidationResult => {
    const w = normalizeWord(raw);
    if (w === null) return { ok: false, reason: 'malformed' };
    if (!words.has(w)) return { ok: false, reason: 'unknown' };
    return { ok: true, word: w };
  };
}

import rawWords from './words/dictionary.json';

export const DICTIONARY = new Set<string>(rawWords as string[]);
export const validateWord = makeValidator(DICTIONARY);
