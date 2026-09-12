import { describe, expect, it, vi } from 'vitest';

const mockRevalidateProductSlugs = vi.fn();
const mockScheduleStorefrontProductPurge = vi.fn();
const mockScheduleProductBlogPurgeAfterResponse = vi.fn();
const mockExpire = vi.fn();
const mockHostnamePurge = vi.fn();
vi.mock('./expire-product-blog-cache', () => ({
  expireProductBlogCache: (...args: unknown[]) => mockExpire(...args),
}));
vi.mock('./storefront-product-purge-hostnames', () => ({
  scheduleStorefrontHostnamePurge: (...args: unknown[]) =>
    mockHostnamePurge(...args),
}));

vi.mock('./cache-revalidation', () => ({
  revalidateProductSlugs: (...args: unknown[]) =>
    mockRevalidateProductSlugs(...args),
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
  it('expires enrichment before a complete purge for incomplete delete snapshots', () => {
    scheduleProductMutationPurge({
      supabase: {} as never,
      merchantId: 'm1',
      merchantSlug: 'store',
      productIds: ['p1'],
      entries: [],
      purgeWholeStorefront: true,
    });
    expect(mockHostnamePurge).toHaveBeenCalledWith('store');
    expect(mockExpire.mock.invocationCallOrder[0]).toBeLessThan(
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

    expect(mockRevalidateProductSlugs).toHaveBeenCalledWith('merchant-1', [
      'new-phone',
      'old-phone',
    ]);
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
});
