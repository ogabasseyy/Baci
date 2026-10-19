import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetchSlugForDomain = vi.fn();

vi.mock('@vercel/edge-config', () => ({
  get: () => Promise.resolve(undefined),
}));
vi.mock('./domain-cache-database', () => ({
  fetchCustomDomain: () => Promise.resolve({ outcome: 'not-found' }),
  fetchSlugForDomain: (...args: unknown[]) => mockFetchSlugForDomain(...args),
}));

const { isRecentlyUnmappedCustomDomain, normalizeDomain, reverseDomainCache } =
  await import('./reverse-domain-cache');
const { getSlugForCustomDomain } = await import('./domain-cache-simple');

describe('reverse-domain-cache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockFetchSlugForDomain.mockReset();
    reverseDomainCache.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    reverseDomainCache.clear();
  });

  it('normalizes domains for cache keys', () => {
    expect(normalizeDomain('  Shop.EXAMPLE.com... ')).toBe('shop.example.com');
  });

  it('reports a seeded reverse miss as recently unmapped within a minute', () => {
    reverseDomainCache.set('miss.test', { slug: null, timestamp: Date.now() });
    expect(isRecentlyUnmappedCustomDomain('miss.test')).toBe(true);
    expect(isRecentlyUnmappedCustomDomain('never-looked-up.test')).toBe(false);
    vi.advanceTimersByTime(59_999);
    expect(isRecentlyUnmappedCustomDomain('miss.test')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(isRecentlyUnmappedCustomDomain('miss.test')).toBe(false);
  });

  it('never reports a mapped domain as unmapped', () => {
    reverseDomainCache.set('mapped.test', {
      slug: 'mapped',
      timestamp: Date.now(),
    });
    expect(isRecentlyUnmappedCustomDomain('mapped.test')).toBe(false);
  });

  it('observes misses written by the shared reverse resolver', async () => {
    mockFetchSlugForDomain.mockResolvedValue({ outcome: 'not-found' });

    await expect(
      getSlugForCustomDomain('reverse-sync-miss.test')
    ).resolves.toBeNull();
    expect(isRecentlyUnmappedCustomDomain('reverse-sync-miss.test')).toBe(true);
  });
});
