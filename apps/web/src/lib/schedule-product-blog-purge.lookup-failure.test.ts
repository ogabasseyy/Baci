import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLookup = vi.fn();
const mockRevalidateProductSlugs = vi.fn();
const mockRevalidateProducts = vi.fn();
const mockSchedule = vi.fn();
const mockHostnamePurge = vi.fn();
const mockExpire = vi.fn().mockResolvedValue(true);

vi.mock('@/lib/cache-revalidation', () => ({
  revalidateProductSlugs: (...args: unknown[]) =>
    mockRevalidateProductSlugs(...args),
  revalidateProducts: (...args: unknown[]) => mockRevalidateProducts(...args),
}));
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
    mockRevalidateProductSlugs.mockReturnValue(true);
    mockRevalidateProducts.mockReturnValue(true);
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

      expect(mockRevalidateProductSlugs).toHaveBeenCalledWith(
        'merchant-1',
        ['pixel-11'],
        { expireImmediately: true }
      );
      expect(mockExpire).toHaveBeenCalledWith('merchant-1', {});
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

  it('purges known articles and escalates to hostname on a partial set', async () => {
    mockLookup.mockResolvedValueOnce({
      slugs: ['known-guide'],
      incomplete: true,
    });
    await scheduleProductBlogPurge({
      supabase,
      merchantId: 'merchant-1',
      merchantSlug: 'store',
      productIds: ['product-1'],
      entries,
    });

    expect(mockSchedule).toHaveBeenCalledWith('store', entries, {
      blogPostSlugs: ['known-guide'],
    });
    expect(mockHostnamePurge).toHaveBeenCalledWith('store');
  });

  it('stays best-effort on a partial set when the caller opted out', async () => {
    mockLookup.mockResolvedValueOnce({
      slugs: ['known-guide'],
      incomplete: true,
    });
    await scheduleProductBlogPurge({
      supabase,
      merchantId: 'merchant-1',
      merchantSlug: 'store',
      productIds: ['product-1'],
      entries,
      skipProductPurge: true,
      skipWhenNoLinkedPosts: true,
    });

    expect(mockSchedule).toHaveBeenCalledWith('store', entries, {
      blogPostSlugs: ['known-guide'],
      blogPostsOnly: true,
    });
    expect(mockHostnamePurge).not.toHaveBeenCalled();
  });

  it('retains pre-delete blog slugs when category fallback lookup fails', async () => {
    mockLookup.mockRejectedValue(new Error('temporary read failure'));

    await scheduleProductBlogPurge({
      supabase,
      merchantId: 'merchant-1',
      merchantSlug: 'store',
      productIds: ['product-1'],
      entries,
      blogPostSlugs: ['direct-guide'],
      categorySlugs: ['smartphones'],
    });

    expect(mockSchedule).toHaveBeenCalledWith('store', entries, {
      blogPostSlugs: ['direct-guide'],
    });
  });

  it('swallows lookup failures so product mutations remain successful', async () => {
    mockLookup.mockRejectedValue(new Error('temporary read failure'));

    await expect(
      scheduleProductBlogPurge({
        supabase,
        merchantId: 'merchant-1',
        merchantSlug: 'store',
        productIds: ['product-1'],
        entries,
      })
    ).resolves.toBeUndefined();

    expect(mockSchedule).toHaveBeenCalledWith('store', entries);
  });

  it('falls back to broad PDP hard expiry and skips edge purge if both local and reliable expiry fail', async () => {
    mockRevalidateProductSlugs.mockReturnValueOnce(false);
    mockRevalidateProducts.mockReturnValueOnce(false);
    mockExpire.mockResolvedValueOnce(false);

    await scheduleProductBlogPurge({
      supabase,
      merchantId: 'merchant-1',
      merchantSlug: 'store',
      productIds: ['product-1'],
      entries,
    });

    expect(mockRevalidateProducts).toHaveBeenCalledWith(
      'merchant-1',
      undefined,
      {
        expireImmediately: true,
      }
    );
    expect(mockExpire).toHaveBeenCalledWith('merchant-1', {
      productSlugs: ['pixel-11'],
      expireWidePdpDetails: true,
    });
    expect(mockSchedule).not.toHaveBeenCalled();
  });
});
