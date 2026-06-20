import { describe, it, expect } from 'vitest';
import { normalizeWord, makeValidator } from '../src/lib/dictionary';

const words = new Set(['cow', 'milk', 'cat']);
const isValid = makeValidator(words);

describe('normalizeWord', () => {
  it('lowercases and trims', () => {
    expect(normalizeWord('  Cow  ')).toBe('cow');
  });
  it('returns null for multi-token input', () => {
    expect(normalizeWord('dairy cow')).toBeNull();
  });
  it('returns null for empty input', () => {
    expect(normalizeWord('   ')).toBeNull();
  });
});

describe('makeValidator', () => {
  it('accepts a recognized word', () => {
    expect(isValid('Milk')).toEqual({ ok: true, word: 'milk' });
  });
  it('rejects gibberish', () => {
    expect(isValid('asdfgh')).toEqual({ ok: false, reason: 'unknown' });
  });
  it('rejects malformed input', () => {
    expect(isValid('two words')).toEqual({ ok: false, reason: 'malformed' });
  });
});
