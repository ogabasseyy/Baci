import { describe, expect, it, vi } from 'vitest';
import { getCachedClusterGuideCandidates } from './get-cached-cluster-guide-candidates';
import { getPublishedClusterPosts } from './get-published-cluster-posts';

vi.mock('./get-cached-cluster-guide-candidates', () => ({
  getCachedClusterGuideCandidates: vi.fn(async () => []),
}));

describe('storefront guide candidate cache key', () => {
  it('shares equivalent search inputs and isolates different merchants and searches', async () => {
    const context = {
      pageKind: 'product' as const,
      categorySlug: 'smartphones' as const,
      brands: ['Apple'],
      productNames: ['Apple iPhone 15 Pro'],
    };

    await getPublishedClusterPosts('merchant-1', context);
    await getPublishedClusterPosts('merchant-1', {
      ...context,
      brands: ['apple', 'Apple'],
      productNames: ['APPLE IPHONE 15 PRO'],
    });
    await getPublishedClusterPosts('merchant-2', context);
    await getPublishedClusterPosts('merchant-1', {
      ...context,
      productNames: ['Apple iPhone 16 Pro'],
    });

    const calls = vi.mocked(getCachedClusterGuideCandidates).mock.calls;
    expect(calls).toHaveLength(4);
    const [merchant, category, searchQuery] = calls[0];
    expect(merchant).toBe('merchant-1');
    expect(category).toBe('smartphones');
    expect(searchQuery).toContain('iphone 15 pro');
    expect(calls[1]).toEqual(calls[0]);
    expect(calls[2]).toEqual(['merchant-2', category, searchQuery]);
    expect(calls[3]).toEqual([
      merchant,
      category,
      expect.stringContaining('iphone 16 pro'),
    ]);
    expect(calls[3]).not.toEqual(calls[0]);
  });
});
