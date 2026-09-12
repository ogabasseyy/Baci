import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnrichProductPurgeEntries = vi.fn();
const mockScheduleStorefrontProductPurge = vi.fn();
const mockExpireProductBlogCacheReliable = vi.fn().mockResolvedValue(true);
const mockRevalidateSlugs = vi.fn();
vi.mock('@/lib/cache-revalidation', () => ({
  revalidateProductSlugs: (...args: unknown[]) => mockRevalidateSlugs(...args),
}));

vi.mock('@/lib/authoritative-product-purge-enrichment', () => ({
  enrichProductPurgeEntries: (...args: unknown[]) =>
    mockEnrichProductPurgeEntries(...args),
}));
vi.mock('@/lib/storefront-product-purge', () => ({
  scheduleStorefrontProductPurge: (...args: unknown[]) =>
    mockScheduleStorefrontProductPurge(...args),
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
    expect(mockRevalidateSlugs).toHaveBeenCalledWith('merchant-1', [
      'iphone-15',
    ]);
    expect(mockRevalidateSlugs.mock.invocationCallOrder[0]).toBeLessThan(
      mockScheduleStorefrontProductPurge.mock.invocationCallOrder[0]
    );
    expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
      'ogabassey',
      [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
      { blogPostSlugs: ['iphone-guide'] }
    );
    expect(mockExpireProductBlogCacheReliable).toHaveBeenCalledWith(
      'merchant-1'
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
      'merchant-1'
    );
    expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
      'ogabassey',
      [{ slug: 'iphone-15', categorySegment: 'smartphones' }]
    );
  });

  it('fails open when merchant slug resolution fails', async () => {
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

      expect(mockEnrichProductPurgeEntries).not.toHaveBeenCalled();
      expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('fails open when product enrichment rejects', async () => {
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

      expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Skipped order-related blog purge after enrichment failed',
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
});
