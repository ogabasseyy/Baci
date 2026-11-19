import { describe, expect, it } from 'vitest';
import { createWarmEdgeDomainReadCache } from './edge-domain-read-cache';

describe('createWarmEdgeDomainReadCache', () => {
  it('expires positive and negative entries at their configured TTLs', () => {
    const cache = createWarmEdgeDomainReadCache({
      maxEntries: 2,
      positiveTtlMs: 60,
      negativeTtlMs: 40,
    });

    cache.setPositive('mapped', 'shop.example.com', 100);
    cache.setNegative('missing', 100);

    expect(cache.get('mapped', 159)).toEqual({
      hit: true,
      value: 'shop.example.com',
    });
    expect(cache.get('mapped', 160)).toEqual({ hit: false });

    expect(cache.get('missing', 139)).toEqual({
      hit: true,
      value: undefined,
    });
    expect(cache.get('missing', 140)).toEqual({ hit: false });
  });

  it('replaces positive with negative and negative with positive for the same key', () => {
    const cache = createWarmEdgeDomainReadCache({
      maxEntries: 2,
      positiveTtlMs: 60,
      negativeTtlMs: 60,
    });

    cache.setNegative('slug', 100);
    expect(cache.get('slug', 110)).toEqual({ hit: true, value: undefined });

    cache.setPositive('slug', 'shop.example.com', 110);
    expect(cache.get('slug', 120)).toEqual({
      hit: true,
      value: 'shop.example.com',
    });

    cache.setNegative('slug', 120);
    expect(cache.get('slug', 130)).toEqual({ hit: true, value: undefined });
  });

  it('evicts oldest negative entries at capacity without evicting positive entries', () => {
    const cache = createWarmEdgeDomainReadCache({
      maxEntries: 2,
      positiveTtlMs: 60,
      negativeTtlMs: 60,
    });

    cache.setPositive('active', 'active.example.com', 100);
    cache.setNegative('miss-1', 100);
    cache.setNegative('miss-2', 101);
    cache.setNegative('miss-3', 102);

    expect(cache.get('miss-1', 102)).toEqual({ hit: false });
    expect(cache.get('miss-2', 102)).toEqual({ hit: true, value: undefined });
    expect(cache.get('miss-3', 102)).toEqual({ hit: true, value: undefined });
    expect(cache.get('active', 102)).toEqual({
      hit: true,
      value: 'active.example.com',
    });
  });

  it('supports deleteKey, deleteValue, clearNegativeEntries, and clear', () => {
    const cache = createWarmEdgeDomainReadCache({
      maxEntries: 4,
      positiveTtlMs: 60,
      negativeTtlMs: 60,
    });

    cache.setPositive('d1.test', 'slug-a', 100);
    cache.setPositive('d2.test', 'slug-b', 100);
    cache.setNegative('d3.test', 100);
    cache.setNegative('d4.test', 100);

    cache.deleteKey('d3.test');
    expect(cache.get('d3.test', 100)).toEqual({ hit: false });
    expect(cache.get('d4.test', 100)).toEqual({ hit: true, value: undefined });

    cache.deleteValue('slug-a');
    expect(cache.get('d1.test', 100)).toEqual({ hit: false });
    expect(cache.get('d2.test', 100)).toEqual({ hit: true, value: 'slug-b' });

    cache.clearNegativeEntries();
    expect(cache.get('d4.test', 100)).toEqual({ hit: false });
    expect(cache.get('d2.test', 100)).toEqual({ hit: true, value: 'slug-b' });

    cache.clear();
    expect(cache.get('d2.test', 100)).toEqual({ hit: false });
  });
});
