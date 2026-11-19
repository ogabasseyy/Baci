import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cache } from './cache';

describe('InMemoryCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-17T12:00:00.000Z'));
    cache.clear();
  });

  afterEach(() => {
    cache.clear();
    vi.useRealTimers();
  });

  it('stores and retrieves non-expired entries and evicts expired entries on read', () => {
    cache.set('k1', { value: 42 }, 10);
    expect(cache.get<{ value: number }>('k1')).toEqual({ value: 42 });

    vi.advanceTimersByTime(10_001);
    expect(cache.get('k1')).toBeNull();
  });

  it('promotes hot keys on get() so capacity eviction drops the least recently used entry', () => {
    for (let i = 0; i < 1000; i++) {
      cache.set(`key-${i}`, i, 600);
    }

    // Touch key-0 so key-1 becomes the least recently used entry.
    expect(cache.get<number>('key-0')).toBe(0);

    cache.set('key-1000', 1000, 600);

    expect(cache.get<number>('key-0')).toBe(0);
    expect(cache.get<number>('key-1')).toBeNull();
    expect(cache.get<number>('key-1000')).toBe(1000);
  });

  it('overwrites existing keys at capacity without evicting other entries', () => {
    for (let i = 0; i < 1000; i++) {
      cache.set(`key-${i}`, i, 600);
    }

    cache.set('key-0', 9999, 600);

    expect(cache.get<number>('key-0')).toBe(9999);
    expect(cache.get<number>('key-1')).toBe(1);
  });

  it('lazily prunes expired entries on write once the prune interval elapses', () => {
    cache.set('short-lived', 'bye', 5);
    vi.advanceTimersByTime(61_000);

    // Writing a new key triggers lazy pruning of expired entries.
    cache.set('fresh', 'hi', 60);
    expect(cache.get('short-lived')).toBeNull();
    expect(cache.get('fresh')).toBe('hi');
  });
});
