import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRevalidateProducts = vi.fn();
const mockRevalidateProductSlugs = vi.fn();
const mockScheduleStorefrontProductPurge = vi.fn();
const mockScheduleStorefrontHostnamePurge = vi.fn();
const mockEnrichProductPurgeEntries = vi.fn();
const mockExpireProductBlogCache = vi.fn();

vi.mock('@/lib/cache-revalidation', () => ({
  revalidateProducts: (...args: unknown[]) => mockRevalidateProducts(...args),
  revalidateProductSlugs: (...args: unknown[]) =>
    mockRevalidateProductSlugs(...args),
}));
vi.mock('@/lib/storefront-product-purge', () => ({
  scheduleStorefrontProductPurge: (...args: unknown[]) =>
    mockScheduleStorefrontProductPurge(...args),
}));
vi.mock('@/lib/storefront-product-purge-hostnames', () => ({
  scheduleStorefrontHostnamePurge: (...args: unknown[]) =>
    mockScheduleStorefrontHostnamePurge(...args),
}));
vi.mock('@/lib/expire-product-blog-cache', () => ({
  expireProductBlogCache: (...args: unknown[]) =>
    mockExpireProductBlogCache(...args),
}));
vi.mock('@/lib/authoritative-product-purge-enrichment', () => ({
  enrichProductPurgeEntries: (...args: unknown[]) =>
    mockEnrichProductPurgeEntries(...args),
}));
vi.mock('@/env', () => ({
  getAppUrl: () => 'https://app.usebaci.com',
  getInternalApiSecret: () => 'test-internal-secret',
}));

import { revalidateProductsReliable } from '@/lib/revalidate-products-reliable';

describe('revalidateProductsReliable enrichment path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRevalidateProducts.mockReturnValue(undefined);
  });

  it('forwards linked blog slugs on the in-process import purge path', async () => {
    const supabase = { from: vi.fn() };
    const products = [{ id: 'product-id', slug: 'iphone-15' }];
    mockEnrichProductPurgeEntries.mockResolvedValue({
      entries: [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
      resolvedSlugs: ['iphone-15'],
      blogPostSlugs: ['iphone-15-buying-guide'],
    });

    await revalidateProductsReliable('merchant-1', {
      merchantSlug: 'ogabassey',
      products,
      supabase: supabase as never,
    });

    expect(mockEnrichProductPurgeEntries).toHaveBeenCalledWith(
      supabase,
      'merchant-1',
      products
    );
    expect(mockRevalidateProductSlugs).toHaveBeenCalledWith('merchant-1', [
      'iphone-15',
      'product-id',
    ]);
    expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
      'ogabassey',
      [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
      { blogPostSlugs: ['iphone-15-buying-guide'] }
    );
    expect(mockExpireProductBlogCache).toHaveBeenCalledWith('merchant-1');
  });

  it('keeps caller-provided purge hints when enrichment rejects', async () => {
    const supabase = { from: vi.fn() };
    const products = [{ slug: 'iphone-15', category: 'Smartphones' }];
    mockEnrichProductPurgeEntries.mockRejectedValue(
      new Error('enrichment timeout')
    );

    await revalidateProductsReliable('merchant-1', {
      merchantSlug: 'ogabassey',
      products,
      supabase: supabase as never,
    });

    expect(mockRevalidateProductSlugs).toHaveBeenCalledWith('merchant-1', [
      'iphone-15',
    ]);
    expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
      'ogabassey',
      [{ slug: 'iphone-15', categorySegment: 'smartphones' }]
    );
  });

  it('skips product and article enrichment for hostname-wide purges', async () => {
    const supabase = { from: vi.fn() };
    const products = [{ id: 'product-id', slug: 'iphone-15' }];

    await revalidateProductsReliable('merchant-1', {
      merchantSlug: 'ogabassey',
      products,
      supabase: supabase as never,
      purgeWholeStorefront: true,
    });

    expect(mockEnrichProductPurgeEntries).not.toHaveBeenCalled();
    expect(mockRevalidateProductSlugs).toHaveBeenCalledWith('merchant-1', [
      'iphone-15',
      'product-id',
    ]);
    expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
    expect(mockScheduleStorefrontHostnamePurge).toHaveBeenCalledWith(
      'ogabassey'
    );
    expect(mockExpireProductBlogCache).toHaveBeenCalledWith('merchant-1');
  });
});
