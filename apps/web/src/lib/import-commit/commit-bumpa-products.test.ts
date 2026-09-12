import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRevalidateProductsReliable = vi.fn();
vi.mock('@/lib/revalidate-products-reliable', () => ({
  revalidateProductsReliable: (...args: unknown[]) =>
    mockRevalidateProductsReliable(...args),
}));

import { commitBumpaProducts } from '@/lib/import-commit/commit-bumpa-products';
import type { NormalizedImportedProduct } from '@/lib/imports/bumpa/bumpa-types';

function createProduct(
  overrides: Partial<NormalizedImportedProduct> = {}
): NormalizedImportedProduct {
  return {
    sourcePlatform: 'bumpa',
    externalSourceId: 'prod-1',
    title: 'Imported Phone',
    description: 'Premium device',
    sku: 'SKU-1',
    price: 150000,
    currency: 'NGN',
    stock: 5,
    manageStock: true,
    status: 'active',
    images: ['https://example.com/phone.jpg'],
    category: 'Phones',
    sourceCreatedAt: '2026-01-01T00:00:00.000Z',
    sourceUpdatedAt: '2026-02-01T00:00:00.000Z',
    importMetadata: { source: 'bumpa' },
    ...overrides,
  };
}

/**
 * Stub for the once-per-run merchant slug lookup
 * (`.from('merchants').select('slug').eq('id', …).maybeSingle()`) the purge
 * adoption performs before the reliable revalidation.
 */
function makeMerchantsQuery(
  slug: string | null,
  error: { message: string } | null = null
) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({
    data: slug === null ? null : { slug },
    error,
  });
  return query;
}

describe('commitBumpaProducts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates existing imported products and inserts new ones with unique slugs', async () => {
    const onProgress = vi.fn();
    const loadQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      range: vi.fn(),
    };
    loadQuery.select.mockReturnValue(loadQuery);
    loadQuery.eq.mockReturnValue(loadQuery);
    loadQuery.order.mockReturnValue(loadQuery);
    loadQuery.range.mockResolvedValue({
      data: [
        {
          id: 'existing-product',
          slug: 'imported-phone',
          external_source: 'bumpa',
          external_id: 'prod-1',
        },
        {
          id: 'other-product',
          slug: 'fresh-phone',
          external_source: null,
          external_id: null,
        },
      ],
      error: null,
    });

    const updateQuery = {
      update: vi.fn(),
      eq: vi.fn(),
    };
    updateQuery.update.mockReturnValue(updateQuery);
    // Chained .eq('id', …).eq('merchant_id', …): first is chainable, last resolves.
    updateQuery.eq
      .mockReturnValueOnce(updateQuery)
      .mockResolvedValueOnce({ error: null });

    const insertQuery = {
      insert: vi.fn(),
    };
    insertQuery.insert.mockResolvedValue({ error: null });

    const merchantsQuery = makeMerchantsQuery('ogabassey');

    const supabase = {
      from: vi
        .fn()
        .mockReturnValueOnce(loadQuery)
        .mockReturnValueOnce(updateQuery)
        .mockReturnValueOnce(insertQuery)
        .mockReturnValueOnce(merchantsQuery),
    } as unknown as SupabaseClient;

    const result = await commitBumpaProducts({
      supabase,
      merchantId: 'merchant-1',
      importJobId: 'job-1',
      products: [
        createProduct(),
        createProduct({
          externalSourceId: 'prod-2',
          title: 'Fresh Phone',
          sku: 'SKU-2',
        }),
      ],
      onProgress,
    });

    expect(result).toEqual({
      createdProducts: 1,
      updatedProducts: 1,
    });
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, {
      processedRecords: 1,
      totalRecords: 2,
    });
    expect(onProgress).toHaveBeenNthCalledWith(2, {
      processedRecords: 2,
      totalRecords: 2,
    });
    expect(updateQuery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        external_id: 'prod-1',
        slug: 'imported-phone',
      })
    );
    // Mutation is tenant-scoped (defense-in-depth under a service-role client).
    expect(updateQuery.eq).toHaveBeenCalledWith('id', 'existing-product');
    expect(updateQuery.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(insertQuery.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        external_id: 'prod-2',
        slug: 'fresh-phone-2',
      })
    );
    // Imported products must invalidate product caches (incl. the proxy
    // crawl-budget slug-set) so their PDPs aren't hard-404ed until TTL expiry —
    // AND evict their public storefront URLs from Cloudflare (merchant slug
    // resolved once per run, id carried for updates so the internal route can
    // resolve the authoritative category).
    expect(mockRevalidateProductsReliable).toHaveBeenCalledWith('merchant-1', {
      merchantSlug: 'ogabassey',
      products: [
        { slug: 'imported-phone', id: 'existing-product', category: 'Phones' },
        { slug: 'fresh-phone-2', category: 'Phones' },
      ],
      nextProductSlugs: ['imported-phone', 'fresh-phone-2'],
      supabase,
    });
  });

  it('still succeeds when reliable revalidation rejects (best-effort, non-fatal)', async () => {
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const loadQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      range: vi.fn(),
    };
    loadQuery.select.mockReturnValue(loadQuery);
    loadQuery.eq.mockReturnValue(loadQuery);
    loadQuery.order.mockReturnValue(loadQuery);
    loadQuery.range.mockResolvedValue({ data: [], error: null });

    const insertQuery = { insert: vi.fn() };
    insertQuery.insert.mockResolvedValue({ error: null });

    const merchantsQuery = makeMerchantsQuery('ogabassey');

    const supabase = {
      from: vi
        .fn()
        .mockReturnValueOnce(loadQuery)
        .mockReturnValueOnce(insertQuery)
        .mockReturnValueOnce(merchantsQuery),
    } as unknown as SupabaseClient;

    // The reliable helper is fail-safe, but even if it rejected the import must
    // not break (the finally swallows it).
    mockRevalidateProductsReliable.mockRejectedValueOnce(
      new Error('revalidation unavailable')
    );

    const result = await commitBumpaProducts({
      supabase,
      merchantId: 'merchant-1',
      importJobId: 'job-1',
      products: [createProduct()],
    });

    expect(result).toEqual({ createdProducts: 1, updatedProducts: 0 });
    expect(mockRevalidateProductsReliable).toHaveBeenCalledWith('merchant-1', {
      merchantSlug: 'ogabassey',
      products: [{ slug: 'imported-phone', category: 'Phones' }],
      nextProductSlugs: ['imported-phone'],
      supabase,
    });
    expect(consoleSpy).toHaveBeenCalled();
    // Restore so the suppressed console.error doesn't leak into later tests
    // (the suite uses clearAllMocks, which does not restore spy implementations).
    consoleSpy.mockRestore();
  });

  it('warns and degrades to Next-cache-only revalidation when the merchants-slug lookup errors', async () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const loadQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      range: vi.fn(),
    };
    loadQuery.select.mockReturnValue(loadQuery);
    loadQuery.eq.mockReturnValue(loadQuery);
    loadQuery.order.mockReturnValue(loadQuery);
    loadQuery.range.mockResolvedValue({ data: [], error: null });

    const insertQuery = { insert: vi.fn() };
    insertQuery.insert.mockResolvedValue({ error: null });

    const merchantsQuery = makeMerchantsQuery(null, {
      message: 'db unavailable',
    });

    const supabase = {
      from: vi
        .fn()
        .mockReturnValueOnce(loadQuery)
        .mockReturnValueOnce(insertQuery)
        .mockReturnValueOnce(merchantsQuery),
    } as unknown as SupabaseClient;

    const result = await commitBumpaProducts({
      supabase,
      merchantId: 'merchant-1',
      importJobId: 'job-1',
      products: [createProduct()],
    });

    expect(result).toEqual({ createdProducts: 1, updatedProducts: 0 });
    // The lookup failure must not break the import: revalidation STILL runs,
    // just degraded to Next-cache-only (no merchantSlug means no Cloudflare
    // purge is attempted).
    expect(mockRevalidateProductsReliable).toHaveBeenCalledWith('merchant-1', {
      nextProductSlugs: ['imported-phone'],
    });
    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to resolve merchant slug for import Cloudflare product purge (degrading to Next-cache-only revalidation):',
      expect.objectContaining({
        importJobId: 'job-1',
        merchantId: 'merchant-1',
        error: { message: 'db unavailable' },
      })
    );
    warnSpy.mockRestore();
  });

  it('revalidates committed mutations even when a later row fails (partial import)', async () => {
    const loadQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      range: vi.fn(),
    };
    loadQuery.select.mockReturnValue(loadQuery);
    loadQuery.eq.mockReturnValue(loadQuery);
    loadQuery.order.mockReturnValue(loadQuery);
    loadQuery.range.mockResolvedValue({ data: [], error: null });

    // First insert commits; the second throws — the first slug is already live.
    const insertOk = { insert: vi.fn().mockResolvedValue({ error: null }) };
    const insertFail = {
      insert: vi.fn().mockResolvedValue({ error: { message: 'boom' } }),
    };

    const merchantsQuery = makeMerchantsQuery('ogabassey');

    const supabase = {
      from: vi
        .fn()
        .mockReturnValueOnce(loadQuery)
        .mockReturnValueOnce(insertOk)
        .mockReturnValueOnce(insertFail)
        .mockReturnValueOnce(merchantsQuery),
    } as unknown as SupabaseClient;

    await expect(
      commitBumpaProducts({
        supabase,
        merchantId: 'merchant-1',
        importJobId: 'job-1',
        products: [
          createProduct({ externalSourceId: 'prod-1', title: 'Phone One' }),
          createProduct({
            externalSourceId: 'prod-2',
            title: 'Phone Two',
            sku: 'SKU-2',
          }),
        ],
      })
    ).rejects.toThrow('Failed to create imported product');

    // The committed first product MUST still trigger revalidation (finally) so
    // its live slug isn't left out of the slug-set until TTL and hard-404ed —
    // and only the committed product is forwarded for the Cloudflare purge.
    expect(mockRevalidateProductsReliable).toHaveBeenCalledWith('merchant-1', {
      merchantSlug: 'ogabassey',
      products: [{ slug: 'phone-one', category: 'Phones' }],
      nextProductSlugs: ['phone-one'],
      supabase,
    });
  });

  it('throws when loading existing products fails', async () => {
    const loadQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      range: vi.fn(),
    };
    loadQuery.select.mockReturnValue(loadQuery);
    loadQuery.eq.mockReturnValue(loadQuery);
    loadQuery.order.mockReturnValue(loadQuery);
    loadQuery.range.mockResolvedValue({
      data: null,
      error: { message: 'load failed' },
    });

    const supabase = {
      from: vi.fn().mockReturnValue(loadQuery),
    } as unknown as SupabaseClient;

    await expect(
      commitBumpaProducts({
        supabase,
        merchantId: 'merchant-1',
        importJobId: 'job-1',
        products: [createProduct()],
      })
    ).rejects.toThrow('Failed to load existing products: load failed');
  });

  it('throws when updating an imported product fails', async () => {
    const loadQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      range: vi.fn(),
    };
    loadQuery.select.mockReturnValue(loadQuery);
    loadQuery.eq.mockReturnValue(loadQuery);
    loadQuery.order.mockReturnValue(loadQuery);
    loadQuery.range.mockResolvedValue({
      data: [
        {
          id: 'existing-product',
          slug: 'imported-phone',
          external_source: 'bumpa',
          external_id: 'prod-1',
        },
      ],
      error: null,
    });

    const updateQuery = {
      update: vi.fn(),
      eq: vi.fn(),
    };
    updateQuery.update.mockReturnValue(updateQuery);
    // Chained .eq('id', …).eq('merchant_id', …): first is chainable, last resolves.
    updateQuery.eq.mockReturnValueOnce(updateQuery).mockResolvedValueOnce({
      error: { message: 'update failed' },
    });

    const supabase = {
      from: vi
        .fn()
        .mockReturnValueOnce(loadQuery)
        .mockReturnValueOnce(updateQuery),
    } as unknown as SupabaseClient;

    await expect(
      commitBumpaProducts({
        supabase,
        merchantId: 'merchant-1',
        importJobId: 'job-1',
        products: [createProduct()],
      })
    ).rejects.toThrow('Failed to update imported product: update failed');
  });

  it('throws when inserting a new imported product fails', async () => {
    const loadQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      range: vi.fn(),
    };
    loadQuery.select.mockReturnValue(loadQuery);
    loadQuery.eq.mockReturnValue(loadQuery);
    loadQuery.order.mockReturnValue(loadQuery);
    loadQuery.range.mockResolvedValue({
      data: [],
      error: null,
    });

    const insertQuery = {
      insert: vi.fn(),
    };
    insertQuery.insert.mockResolvedValue({
      error: { message: 'insert failed' },
    });

    const supabase = {
      from: vi
        .fn()
        .mockReturnValueOnce(loadQuery)
        .mockReturnValueOnce(insertQuery),
    } as unknown as SupabaseClient;

    await expect(
      commitBumpaProducts({
        supabase,
        merchantId: 'merchant-1',
        importJobId: 'job-1',
        products: [createProduct()],
      })
    ).rejects.toThrow('Failed to create imported product: insert failed');
  });
});
