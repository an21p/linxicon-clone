import { describe, it, expect } from 'vitest';
import { cacheKey } from '../src/lib/embeddings';

describe('cache namespacing', () => {
  it('includes the model id so dims never collide', () => {
    expect(cacheKey('minilm', 'cow')).toBe('vec:minilm:cow');
    expect(cacheKey('numberbatch', 'cow')).toBe('vec:numberbatch:cow');
  });

  it('switching model changes the cache namespace for the same word', () => {
    expect(cacheKey('minilm', 'cow')).not.toBe(cacheKey('numberbatch', 'cow'));
  });
});
