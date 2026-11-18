import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAfter = vi.fn();
const mockRevalidateProductSlugs = vi.fn();
const mockRevalidateProducts = vi.fn();
const mockScheduleStorefrontProductPurge = vi.fn();
const mockScheduleProductBlogPurgeAfterResponse = vi.fn();
const mockExpire = vi.fn();
const mockExpireReliable = vi.fn();
const mockHostnamePurge = vi.fn();
vi.mock('next/server', () => ({
  after: (...args: unknown[]) => mockAfter(...args),
}));
vi.mock('./expire-product-blog-cache', () => ({
  expireProductBlogCache: (...args: unknown[]) => mockExpire(...args),
}));
vi.mock('./expire-product-blog-cache-reliable', () => ({
  expireProductBlogCacheReliable: (...args: unknown[]) =>
    mockExpireReliable(...args),
}));
vi.mock('./storefront-product-purge-hostnames', () => ({
  scheduleStorefrontHostnamePurge: (...args: unknown[]) =>
    mockHostnamePurge(...args),
}));

vi.mock('./cache-revalidation', () => ({
  revalidateProductSlugs: (...args: unknown[]) =>
    mockRevalidateProductSlugs(...args),
  revalidateProducts: (...args: unknown[]) => mockRevalidateProducts(...args),
}));
vi.mock('./schedule-product-blog-purge-after-response', () => ({
  scheduleProductBlogPurgeAfterResponse: (...args: unknown[]) =>
    mockScheduleProductBlogPurgeAfterResponse(...args),
}));
vi.mock('./storefront-product-purge', () => ({
  scheduleStorefrontProductPurge: (...args: unknown[]) =>
    mockScheduleStorefrontProductPurge(...args),
}));

import { scheduleProductMutationPurge } from './schedule-product-mutation-purge';

describe('scheduleProductMutationPurge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRevalidateProducts.mockReturnValue(true);
    mockRevalidateProductSlugs.mockReturnValue(true);
    mockExpireReliable.mockResolvedValue(true);
  });

  it('expires enrichment before a complete purge for incomplete delete snapshots', () => {
    scheduleProductMutationPurge({
      supabase: {} as never,
      merchantId: 'm1',
      merchantSlug: 'store',
      productIds: ['p1'],
      entries: [],
      purgeWholeStorefront: true,
    });
    expect(mockRevalidateProducts).toHaveBeenCalledWith('m1', undefined, {
      expireImmediately: true,
    });
    expect(mockHostnamePurge).toHaveBeenCalledWith('store');
    expect(mockExpire.mock.invocationCallOrder[0]).toBeLessThan(
      mockHostnamePurge.mock.invocationCallOrder[0]
    );
    expect(mockRevalidateProducts.mock.invocationCallOrder[0]).toBeLessThan(
      mockHostnamePurge.mock.invocationCallOrder[0]
    );
  });
  it('revalidates core slugs before scheduling the deferred article purge', () => {
    const entries = [
      { slug: 'new-phone', categorySegment: 'smartphones' },
      { slug: 'old-phone', categorySegment: 'audio' },
    ] as const;
    const supabase = {} as Parameters<
      typeof scheduleProductMutationPurge
    >[0]['supabase'];

    scheduleProductMutationPurge({
      supabase,
      merchantId: 'merchant-1',
      merchantSlug: 'test-store',
      productIds: ['product-1'],
      entries,
      blogPostSlugs: ['old-article'],
    });

    expect(mockRevalidateProductSlugs).toHaveBeenCalledWith(
      'merchant-1',
      ['new-phone', 'old-phone'],
      { expireImmediately: true }
    );
    expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
      'test-store',
      entries
    );
    expect(mockScheduleProductBlogPurgeAfterResponse).toHaveBeenCalledWith({
      supabase,
      merchantId: 'merchant-1',
      merchantSlug: 'test-store',
      productIds: ['product-1'],
      entries,
      blogPostSlugs: ['old-article'],
      categorySlugs: ['smartphones', 'audio'],
      skipProductPurge: true,
    });
    expect(mockRevalidateProductSlugs.mock.invocationCallOrder[0]).toBeLessThan(
      mockScheduleStorefrontProductPurge.mock.invocationCallOrder[0]
    );
  });

  it('defers reliable PDP expiry before hostname purge when local broad expiry fails', async () => {
    mockRevalidateProducts.mockReturnValueOnce(false);
    scheduleProductMutationPurge({
      supabase: {} as never,
      merchantId: 'm1',
      merchantSlug: 'store',
      productIds: ['p1'],
      entries: [],
      purgeWholeStorefront: true,
    });

    expect(mockHostnamePurge).not.toHaveBeenCalled();
    await mockAfter.mock.calls[0][0]();
    expect(mockExpireReliable).toHaveBeenCalledWith('m1', {
      expireWidePdpDetails: true,
    });
    expect(mockHostnamePurge).toHaveBeenCalledWith('store');
  });

  it('skips hostname purge when reliable broad PDP expiry also fails', async () => {
    mockRevalidateProducts.mockReturnValueOnce(false);
    mockExpireReliable.mockResolvedValueOnce(false);
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      scheduleProductMutationPurge({
        supabase: {} as never,
        merchantId: 'm1',
        merchantSlug: 'store',
        productIds: ['p1'],
        entries: [],
        purgeWholeStorefront: true,
      });

      await mockAfter.mock.calls[0][0]();
      expect(mockHostnamePurge).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        'Skipped mutation hostname purge because PDP hard expiry failed',
        expect.objectContaining({ merchantId: 'm1' })
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('falls back to broad hard expiry when per-slug expiry fails on a scoped mutation', () => {
    mockRevalidateProductSlugs.mockReturnValueOnce(false);
    const entries = [{ slug: 'new-phone', categorySegment: 'smartphones' }];

    scheduleProductMutationPurge({
      supabase: {} as never,
      merchantId: 'merchant-1',
      merchantSlug: 'test-store',
      productIds: ['product-1'],
      entries,
    });

    expect(mockRevalidateProducts).toHaveBeenCalledWith(
      'merchant-1',
      undefined,
      { expireImmediately: true }
    );
    expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
      'test-store',
      entries
    );
    expect(mockAfter).not.toHaveBeenCalled();
  });

  it('defers reliable PDP expiry before edge purges when both per-slug and broad hard expiry fail', async () => {
    mockRevalidateProductSlugs.mockReturnValueOnce(false);
    mockRevalidateProducts.mockReturnValueOnce(false);
    const entries = [{ slug: 'new-phone', categorySegment: 'smartphones' }];

    scheduleProductMutationPurge({
      supabase: {} as never,
      merchantId: 'merchant-1',
      merchantSlug: 'test-store',
      productIds: ['product-1'],
      entries,
      blogPostSlugs: ['old-article'],
    });

    expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
    expect(mockScheduleProductBlogPurgeAfterResponse).not.toHaveBeenCalled();
    await mockAfter.mock.calls[0][0]();
    expect(mockExpireReliable).toHaveBeenCalledWith('merchant-1', {
      expireWidePdpDetails: true,
    });
    expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
      'test-store',
      entries
    );
    expect(mockScheduleProductBlogPurgeAfterResponse).toHaveBeenCalledWith({
      supabase: expect.anything(),
      merchantId: 'merchant-1',
      merchantSlug: 'test-store',
      productIds: ['product-1'],
      entries,
      blogPostSlugs: ['old-article'],
      categorySlugs: ['smartphones'],
      skipProductPurge: true,
    });
  });
});
