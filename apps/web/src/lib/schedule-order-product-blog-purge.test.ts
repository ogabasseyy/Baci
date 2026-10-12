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
}));
vi.mock('@/lib/storefront-product-purge-hostnames', () => ({
  scheduleStorefrontHostnamePurge: (...args: unknown[]) =>
    mockScheduleStorefrontHostnamePurge(...args),
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
    mockEnrichProductPurgeEntries.mockResolvedValue({
      entries: [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
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
      ['iphone-15'],
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
    // Resolved slugs get exact scoped busts; the broad hard-expire is
    // reserved for the unknown-slug rejection path.
    expect(mockRevalidateProducts).not.toHaveBeenCalled();
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

  it('continues local invalidation when merchant slug resolution fails', async () => {
    const consoleSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      const { supabase } = makeSupabase({
        merchantError: new Error('merchant lookup failed'),
      });

      await scheduleOrderProductBlogPurge({
        merchantId: 'merchant-1',
        productIds: ['product-1'],
        supabase: supabase as never,
      });

      // The inventory mutation already committed: enrichment, per-slug
      // revalidation, and blog-cache expiry need only the merchant id, so
      // a transient slug lookup failure gates only the edge purge.
      expect(mockEnrichProductPurgeEntries).toHaveBeenCalled();
      expect(mockRevalidateSlugs).toHaveBeenCalledWith(
        'merchant-1',
        ['iphone-15'],
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

  it('evicts the hostname from caller hints when product enrichment rejects', async () => {
    const consoleSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      const { supabase } = makeSupabase({});
      mockEnrichProductPurgeEntries.mockRejectedValue(
        new Error('enrichment timeout')
      );

      await expect(
        scheduleOrderProductBlogPurge({
          merchantId: 'merchant-1',
          merchantSlug: 'ogabassey',
          productIds: ['product-1'],
          supabase: supabase as never,
        })
      ).resolves.toBeUndefined();

      // The caller-supplied ids still name the affected products, so a
      // rejected enrichment escalates to the hostname fallback instead of
      // skipping invalidation entirely.
      expect(mockRevalidateSlugs).toHaveBeenCalledWith(
        'merchant-1',
        ['product-1'],
        { expireImmediately: true }
      );
      // The canonical slugs are unknown, so the id-scoped bust above cannot
      // reach the slug-tagged outer PDP entries: the broad merchant tags
      // (incl. `product-details`) are hard-expired so the first post-purge
      // request cannot refill the edge from a stale snapshot.
      expect(mockRevalidateProducts).toHaveBeenCalledWith(
        'merchant-1',
        undefined,
        { expireImmediately: true }
      );
      expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
      expect(mockScheduleStorefrontHostnamePurge).toHaveBeenCalledWith(
        'ogabassey'
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        'Order-related product enrichment failed; continuing with caller hints',
        expect.objectContaining({ merchantId: 'merchant-1' })
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('skips empty product batches without querying or scheduling', async () => {
    const { supabase, maybeSingle } = makeSupabase({});

    await scheduleOrderProductBlogPurge({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      productIds: [null, '  '],
      supabase: supabase as never,
    });

    expect(maybeSingle).not.toHaveBeenCalled();
    expect(mockEnrichProductPurgeEntries).not.toHaveBeenCalled();
    expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
  });

  it('evicts the hostname when the article lookup reports incomplete', async () => {
    const { supabase } = makeSupabase({});
    mockEnrichProductPurgeEntries.mockResolvedValueOnce({
      entries: [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
      blogPostSlugs: [],
      blogPostSlugsIncomplete: true,
    });

    await scheduleOrderProductBlogPurge({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      productIds: ['product-1'],
      supabase: supabase as never,
    });

    expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
    expect(mockScheduleStorefrontHostnamePurge).toHaveBeenCalledWith(
      'ogabassey'
    );
  });

  it('evicts the hostname when the caller sweep reports incomplete', async () => {
    const { supabase } = makeSupabase({});

    await scheduleOrderProductBlogPurge({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      productIds: ['product-1'],
      supabase: supabase as never,
      targetSweepIncomplete: true,
    });

    expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
    expect(mockScheduleStorefrontHostnamePurge).toHaveBeenCalledWith(
      'ogabassey'
    );
  });

  it('skips the edge purge when the worker hard-expiry reports failure', async () => {
    const consoleSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      const { supabase, maybeSingle } = makeSupabase({});
      mockExpireProductBlogCacheReliable.mockResolvedValueOnce(false);

      await scheduleOrderProductBlogPurge({
        merchantId: 'merchant-1',
        productIds: ['product-1'],
        supabase: supabase as never,
      });

      expect(mockRevalidateSlugs).toHaveBeenCalled();
      expect(mockExpireProductBlogCacheReliable).toHaveBeenCalledWith(
        'merchant-1',
        { productSlugs: ['iphone-15'] }
      );
      expect(maybeSingle).not.toHaveBeenCalled();
      expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Skipped order-related edge purge because blog-cache hard expiry failed',
        expect.objectContaining({ merchantId: 'merchant-1' })
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
