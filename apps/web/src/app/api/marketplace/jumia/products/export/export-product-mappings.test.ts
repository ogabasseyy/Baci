import { describe, expect, it, vi } from 'vitest';
import {
  applyMarketplaceCurrency,
  createPartialExportResponse,
  linkExportProductMappings,
} from './export-product-mappings';

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

const exportVariations = [
  { sellerSku: 'SKU-1', price: 100, currency: 'NGN', stock: 2 },
];

function createSupabaseMock(handlers: {
  productLookup?: { data: { id: string } | null; error: unknown };
  variantsLookup?: { data: Array<{ id: string; sku: string }>; error: unknown };
  upsert?: { error: unknown };
}) {
  const upsert = vi.fn().mockResolvedValue(handlers.upsert ?? { error: null });
  return {
    from: vi.fn((table: string) => {
      if (table === 'products') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi
                  .fn()
                  .mockResolvedValue(
                    handlers.productLookup ?? { data: null, error: null }
                  ),
              }),
            }),
          }),
        };
      }
      if (table === 'product_variants') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi
                  .fn()
                  .mockResolvedValue(
                    handlers.variantsLookup ?? { data: [], error: null }
                  ),
              }),
            }),
          }),
        };
      }
      if (table === 'jumia_product_mappings') {
        return { upsert };
      }
      return {};
    }),
    upsert,
  };
}

describe('applyMarketplaceCurrency', () => {
  it('overrides every variation currency with the marketplace currency', () => {
    expect(
      applyMarketplaceCurrency(
        [{ sellerSku: 'SKU-1', price: 100, currency: 'NGN' }],
        'GHS'
      )
    ).toEqual([{ sellerSku: 'SKU-1', price: 100, currency: 'GHS' }]);
  });
});

describe('createPartialExportResponse', () => {
  it('returns a 207 partial failure payload', async () => {
    const response = createPartialExportResponse('feed-1', 'Mapping failed', {
      lookupFailed: true,
    });

    expect(response.status).toBe(207);
    await expect(response.json()).resolves.toEqual({
      success: false,
      partial: true,
      feedId: 'feed-1',
      error: 'Mapping failed',
      message: 'Mapping failed',
      lookupFailed: true,
    });
  });
});

describe('linkExportProductMappings', () => {
  it('returns early when there are no exportable variations', async () => {
    const result = await linkExportProductMappings({
      supabase: createSupabaseMock({}) as never,
      merchantId: 'merchant-1',
      shopId: 'shop-1',
      marketplaceKey: 'Jumia NG',
      feedId: 'feed-1',
      exportVariations: [],
      linkedProductId: null,
      variantIdsBySku: new Map(),
    });

    expect(result).toEqual({
      ok: true,
      linkedProductId: null,
      primarySku: '',
    });
  });

  it('upserts mappings when the product id is already known', async () => {
    const supabase = createSupabaseMock({});
    const result = await linkExportProductMappings({
      supabase: supabase as never,
      merchantId: 'merchant-1',
      shopId: 'shop-1',
      marketplaceKey: 'Jumia NG',
      feedId: 'feed-1',
      exportVariations,
      linkedProductId: 'prod-1',
      variantIdsBySku: new Map([['SKU-1', 'variant-1']]),
    });

    expect(result).toEqual({
      ok: true,
      linkedProductId: 'prod-1',
      primarySku: 'SKU-1',
    });
    expect(supabase.upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          merchant_id: 'merchant-1',
          product_id: 'prod-1',
          variant_id: 'variant-1',
          jumia_sku: 'SKU-1',
          jumia_shop_id: 'shop-1',
          marketplace_key: 'Jumia NG',
          last_feed_id: 'feed-1',
          sync_status: 'pending',
        }),
      ],
      { onConflict: 'product_id,variant_id,jumia_shop_id,marketplace_key' }
    );
  });

  it('merges SKU-based variant ids for multi-variation exports', async () => {
    const supabase = createSupabaseMock({
      productLookup: { data: { id: 'prod-1' }, error: null },
      variantsLookup: {
        data: [
          { id: 'variant-1', sku: 'SKU-1' },
          { id: 'variant-2', sku: 'SKU-2' },
        ],
        error: null,
      },
    });
    const result = await linkExportProductMappings({
      supabase: supabase as never,
      merchantId: 'merchant-1',
      shopId: 'shop-1',
      marketplaceKey: 'Jumia NG',
      feedId: 'feed-1',
      exportVariations: [
        { sellerSku: 'SKU-1', price: 100, currency: 'NGN', stock: 2 },
        { sellerSku: 'SKU-2', price: 120, currency: 'NGN', stock: 4 },
      ],
      linkedProductId: null,
      variantIdsBySku: new Map(),
    });

    expect(result).toEqual({
      ok: true,
      linkedProductId: 'prod-1',
      primarySku: 'SKU-1',
    });
    expect(supabase.upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          product_id: 'prod-1',
          variant_id: 'variant-1',
          jumia_sku: 'SKU-1',
        }),
        expect.objectContaining({
          product_id: 'prod-1',
          variant_id: 'variant-2',
          jumia_sku: 'SKU-2',
        }),
      ],
      { onConflict: 'product_id,variant_id,jumia_shop_id,marketplace_key' }
    );
  });

  it('returns a partial failure when product lookup errors after feed creation', async () => {
    const result = await linkExportProductMappings({
      supabase: createSupabaseMock({
        productLookup: { data: null, error: { message: 'DB down' } },
      }) as never,
      merchantId: 'merchant-1',
      shopId: 'shop-1',
      marketplaceKey: 'Jumia NG',
      feedId: 'feed-1',
      exportVariations,
      linkedProductId: null,
      variantIdsBySku: new Map(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(207);
    await expect(result.response.json()).resolves.toMatchObject({
      success: false,
      partial: true,
      feedId: 'feed-1',
      lookupFailed: true,
    });
  });

  it('returns a partial failure when variant lookup errors', async () => {
    const result = await linkExportProductMappings({
      supabase: createSupabaseMock({
        productLookup: { data: { id: 'prod-1' }, error: null },
        variantsLookup: {
          data: [],
          error: { message: 'variant lookup failed' },
        },
      }) as never,
      merchantId: 'merchant-1',
      shopId: 'shop-1',
      marketplaceKey: 'Jumia NG',
      feedId: 'feed-1',
      exportVariations,
      linkedProductId: null,
      variantIdsBySku: new Map(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(207);
    await expect(result.response.json()).resolves.toMatchObject({
      lookupFailed: true,
    });
  });

  it('skips mapping upsert when no local product matches the primary SKU', async () => {
    const supabase = createSupabaseMock({
      productLookup: { data: null, error: null },
    });
    const result = await linkExportProductMappings({
      supabase: supabase as never,
      merchantId: 'merchant-1',
      shopId: 'shop-1',
      marketplaceKey: 'Jumia NG',
      feedId: 'feed-1',
      exportVariations,
      linkedProductId: null,
      variantIdsBySku: new Map(),
    });

    expect(result).toEqual({
      ok: true,
      linkedProductId: null,
      primarySku: 'SKU-1',
    });
    expect(supabase.upsert).not.toHaveBeenCalled();
  });

  it('returns a partial failure when mapping upsert fails', async () => {
    const result = await linkExportProductMappings({
      supabase: createSupabaseMock({
        upsert: { error: { message: 'upsert failed' } },
      }) as never,
      merchantId: 'merchant-1',
      shopId: 'shop-1',
      marketplaceKey: 'Jumia NG',
      feedId: 'feed-1',
      exportVariations,
      linkedProductId: 'prod-1',
      variantIdsBySku: new Map(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(207);
    await expect(result.response.json()).resolves.toMatchObject({
      success: false,
      partial: true,
      feedId: 'feed-1',
    });
  });
});
