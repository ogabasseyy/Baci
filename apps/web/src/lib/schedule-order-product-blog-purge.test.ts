import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnrichProductPurgeEntries = vi.fn();
const mockScheduleStorefrontProductPurge = vi.fn();
const mockScheduleStorefrontHostnamePurge = vi.fn();
const mockExpireProductBlogCacheReliable = vi.fn().mockResolvedValue(true);
const mockRevalidateSlugs = vi.fn();
const mockRevalidateProducts = vi.fn();
vi.mock('@/lib/cache-revalidation', () => ({
  revalidateProductSlugs: (...args: unknown[]) => mockRevalidateSlugs(...args),
  revalidateProducts: (...args: unknown[]) => mockRevalidateProducts(...args),
}));

vi.mock('@/lib/authoritative-product-purge-enrichment', () => ({
  enrichProductPurgeEntries: (...args: unknown[]) =>
    mockEnrichProductPurgeEntries(...args),
}));
vi.mock('@/lib/storefront-product-purge', () => ({
  scheduleStorefrontProductPurge: (...args: unknown[]) =>
    mockScheduleStorefrontProductPurge(...args),
  purgeStorefrontProductConfirmed: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/lib/storefront-product-purge-hostnames', () => ({
  scheduleStorefrontHostnamePurge: (...args: unknown[]) =>
    mockScheduleStorefrontHostnamePurge(...args),
  purgeStorefrontHostnameConfirmed: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/lib/expire-product-blog-cache-reliable', () => ({
  expireProductBlogCacheReliable: (...args: unknown[]) =>
    mockExpireProductBlogCacheReliable(...args),
}));

import { scheduleOrderProductBlogPurge } from './schedule-order-product-blog-purge';

function makeSupabase(options: {
  merchantSlug?: string | null;
  merchantError?: Error | null;
}) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data:
      options.merchantError || options.merchantSlug === undefined
        ? null
        : { slug: options.merchantSlug },
    error: options.merchantError,
  });
  const supabase = {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle,
    })),
  };
  return { maybeSingle, supabase };
}

describe('scheduleOrderProductBlogPurge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRevalidateProducts.mockReturnValue(true);
    mockRevalidateSlugs.mockReturnValue(true);
    mockEnrichProductPurgeEntries.mockResolvedValue({
      entries: [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
      authoritativeSlugsById: new Map([['product-1', 'iphone-15']]),
      blogPostSlugs: ['iphone-guide'],
    });
  });

  it('purges linked article URLs after an order changes product stock', async () => {
    const { supabase } = makeSupabase({});

    await scheduleOrderProductBlogPurge({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      productIds: ['product-1', ' product-1 ', null],
      supabase: supabase as never,
    });

    expect(mockEnrichProductPurgeEntries).toHaveBeenCalledWith(
      supabase,
      'merchant-1',
      [{ id: 'product-1' }]
    );
    expect(mockRevalidateSlugs).toHaveBeenCalledWith(
      'merchant-1',
      ['iphone-15', 'product-1'],
      { expireImmediately: true }
    );
    expect(mockRevalidateSlugs.mock.invocationCallOrder[0]).toBeLessThan(
      mockScheduleStorefrontProductPurge.mock.invocationCallOrder[0]
    );
    expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
      'ogabassey',
      [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
      { blogPostSlugs: ['iphone-guide'] }
    );
    expect(mockExpireProductBlogCacheReliable).toHaveBeenCalledWith(
      'merchant-1',
      { productSlugs: ['iphone-15'] }
    );
    // Resolved slugs get exact scoped PDP + listing busts without touching
    // unrelated merchant-wide PDP details.
    expect(mockRevalidateProducts).toHaveBeenCalledTimes(1);
    expect(mockRevalidateProducts).toHaveBeenCalledWith(
      'merchant-1',
      undefined,
      { expireImmediately: true, omitMerchantWidePdpDetails: true }
    );
  });

  it('resolves the merchant slug before purging when the caller has no slug', async () => {
    const { maybeSingle, supabase } = makeSupabase({
      merchantSlug: 'ogabassey',
    });

    await scheduleOrderProductBlogPurge({
      merchantId: 'merchant-1',
      productIds: ['product-1'],
      supabase: supabase as never,
    });

    expect(maybeSingle).toHaveBeenCalledOnce();
    expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
      'ogabassey',
      expect.any(Array),
      expect.any(Object)
    );
  });

  it('keeps the core purge when no published article is linked', async () => {
    mockEnrichProductPurgeEntries.mockResolvedValue({
      entries: [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
      authoritativeSlugsById: new Map([['product-1', 'iphone-15']]),
      blogPostSlugs: [],
    });
    const { supabase } = makeSupabase({});

    await scheduleOrderProductBlogPurge({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      productIds: ['product-1'],
      supabase: supabase as never,
    });

    expect(mockExpireProductBlogCacheReliable).toHaveBeenCalledWith(
      'merchant-1',
      { productSlugs: ['iphone-15'] }
    );
    expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
      'ogabassey',
      [{ slug: 'iphone-15', categorySegment: 'smartphones' }]
    );
  });

  it('falls back to broad hard expiry and reliable wide PDP expiry when scoped listing expiry returns false', async () => {
    mockRevalidateProducts
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false);
    const { supabase } = makeSupabase({});

    await scheduleOrderProductBlogPurge({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      productIds: ['product-1'],
      supabase: supabase as never,
    });

    expect(mockRevalidateProducts).toHaveBeenNthCalledWith(
      1,
      'merchant-1',
      undefined,
      { expireImmediately: true, omitMerchantWidePdpDetails: true }
    );
    expect(mockRevalidateProducts).toHaveBeenNthCalledWith(
      2,
      'merchant-1',
      undefined,
      { expireImmediately: true }
    );
    expect(mockExpireProductBlogCacheReliable).toHaveBeenCalledWith(
      'merchant-1',
      { productSlugs: ['iphone-15'], expireWidePdpDetails: true }
    );
  });

  it('continues local invalidation when merchant slug resolution fails', async () => {
    const consoleSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      const { supabase } = makeSupabase({
        merchantError: new Error('merchant lookup failed'),
      });

      const result = await scheduleOrderProductBlogPurge({
        merchantId: 'merchant-1',
        productIds: ['product-1'],
        supabase: supabase as never,
      });

      expect(result).toBe(false);

      // The inventory mutation already committed: enrichment, per-slug
      // revalidation, and blog-cache expiry need only the merchant id, so
      // a transient slug lookup failure gates only the edge purge.
      expect(mockEnrichProductPurgeEntries).toHaveBeenCalled();
      expect(mockRevalidateSlugs).toHaveBeenCalledWith(
        'merchant-1',
        ['iphone-15', 'product-1'],
        { expireImmediately: true }
      );
      expect(mockExpireProductBlogCacheReliable).toHaveBeenCalledWith(
        'merchant-1',
        { productSlugs: ['iphone-15'] }
      );
      expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Skipped order-related edge purge because merchant slug lookup failed',
        expect.objectContaining({ merchantId: 'merchant-1' })
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('hard-expires merchant-wide PDP details when enrichProductPurgeEntries omits an authoritative slug', async () => {
    mockEnrichProductPurgeEntries.mockResolvedValueOnce({
      entries: [{ slug: 'product-1', categorySegment: null }],
      authoritativeSlugsById: new Map<string, string>(),
      blogPostSlugs: [],
    });
    const { supabase } = makeSupabase({});

    await scheduleOrderProductBlogPurge({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      productIds: ['product-1'],
      supabase: supabase as never,
    });

    expect(mockRevalidateProducts).toHaveBeenCalledWith(
      'merchant-1',
      undefined,
      { expireImmediately: true }
    );
  });

  it('hard-expires merchant-wide PDP details when revalidateProductSlugs returns false', async () => {
    mockRevalidateSlugs.mockReturnValueOnce(false);
    const { supabase } = makeSupabase({});

    await scheduleOrderProductBlogPurge({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      productIds: ['product-1'],
      supabase: supabase as never,
    });

    expect(mockRevalidateProducts).toHaveBeenCalledWith(
      'merchant-1',
      undefined,
      { expireImmediately: true }
    );
  });
});
