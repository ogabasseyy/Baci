import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLookup = vi.fn();
const mockSchedule = vi.fn();
const mockHostnamePurge = vi.fn();
const mockExpire = vi.fn().mockResolvedValue(true);

vi.mock('@/lib/get-published-blog-post-slugs-for-products', () => ({
  getPublishedBlogPostSlugsForProducts: (...args: unknown[]) =>
    mockLookup(...args),
}));
vi.mock('@/lib/storefront-product-purge', () => ({
  scheduleStorefrontProductPurge: (...args: unknown[]) => mockSchedule(...args),
}));
vi.mock('@/lib/storefront-product-purge-hostnames', () => ({
  scheduleStorefrontHostnamePurge: (...args: unknown[]) =>
    mockHostnamePurge(...args),
}));
vi.mock('@/lib/expire-product-blog-cache-reliable', () => ({
  expireProductBlogCacheReliable: (...args: unknown[]) => mockExpire(...args),
}));

import { scheduleProductBlogPurge } from './schedule-product-blog-purge';

const supabase = {} as never;
const entries = [{ slug: 'pixel-11', categorySegment: 'smartphones' }];

describe('scheduleProductBlogPurge lookup failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('still expires and dispatches the entries purge when the slug lookup rejects', async () => {
    mockLookup.mockRejectedValueOnce(new Error('lookup unavailable'));
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      await scheduleProductBlogPurge({
        supabase,
        merchantId: 'merchant-1',
        merchantSlug: 'store',
        productIds: ['product-1'],
        entries,
      });

      expect(mockExpire).toHaveBeenCalledWith('merchant-1');
      expect(mockSchedule).toHaveBeenCalledTimes(1);
      expect(mockSchedule).toHaveBeenCalledWith('store', entries);
      expect(mockHostnamePurge).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        'Skipped product blog purge scheduling',
        expect.objectContaining({ merchantId: 'merchant-1' })
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('evicts the hostname when the lookup fails for a blog-only follow-up', async () => {
    mockLookup.mockRejectedValueOnce(new Error('category lookup unavailable'));
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      await scheduleProductBlogPurge({
        supabase,
        merchantId: 'merchant-1',
        merchantSlug: 'store',
        productIds: ['product-1'],
        entries,
        skipProductPurge: true,
      });

      expect(mockSchedule).not.toHaveBeenCalled();
      expect(mockHostnamePurge).toHaveBeenCalledWith('store');
      expect(warnSpy).toHaveBeenCalledWith(
        'Skipped product blog purge scheduling',
        expect.objectContaining({ merchantId: 'merchant-1' })
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});
