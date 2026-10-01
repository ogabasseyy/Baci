import { describe, expect, it } from 'vitest';
import { createWarmPositiveCache } from './create-warm-positive-cache';

describe('createWarmPositiveCache', () => {
  it('expires positive values at the bounded TTL', () => {
    const cache = createWarmPositiveCache({ maxEntries: 2, ttlMs: 60 });
    cache.set('slug', 'domain.example', 100);

    expect(cache.get('slug', 159)).toBe('domain.example');
    expect(cache.get('slug', 160)).toBeUndefined();
  });

  it('evicts the oldest key and supports targeted value invalidation', () => {
    const cache = createWarmPositiveCache({ maxEntries: 2, ttlMs: 60 });
    cache.set('first', 'merchant-a', 100);
    cache.set('second', 'merchant-b', 101);
    cache.set('third', 'merchant-a', 102);

    expect(cache.get('first', 102)).toBeUndefined();
    cache.deleteValue('merchant-a');
    expect(cache.get('third', 102)).toBeUndefined();
    expect(cache.get('second', 102)).toBe('merchant-b');
  });

  it('deletes only the targeted key', () => {
    const cache = createWarmPositiveCache({ maxEntries: 2, ttlMs: 60 });
    cache.set('first', 'merchant-a', 100);
    cache.set('second', 'merchant-b', 100);

    cache.deleteKey('first');

    expect(cache.get('first', 100)).toBeUndefined();
    expect(cache.get('second', 100)).toBe('merchant-b');
  });
});
