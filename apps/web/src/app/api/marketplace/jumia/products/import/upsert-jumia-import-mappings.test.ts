import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

import {
  persistJumiaImportEntries,
  upsertJumiaImportMappings,
} from './upsert-jumia-import-mappings';

describe('upsertJumiaImportMappings', () => {
  it('uses the marketplace-scoped mapping constraint', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const supabase = {
      from: vi.fn(() => ({ upsert })),
    };

    await upsertJumiaImportMappings({
      supabase: supabase as never,
      rows: [
        {
          merchant_id: 'merchant-1',
          product_id: 'product-1',
          variant_id: null,
          jumia_sku: 'SKU-1',
          jumia_seller_sku: 'SKU-1',
          jumia_shop_id: 'shop-ng',
          marketplace_key: 'NG',
          jumia_price: 100,
          jumia_product_id: 'jumia-1',
          is_active: true,
          sync_status: 'synced',
          last_synced_at: new Date(0).toISOString(),
        },
      ],
    });

    expect(upsert).toHaveBeenCalledWith(expect.any(Array), {
      onConflict: 'product_id,variant_id,jumia_shop_id,marketplace_key',
    });
  });

  it('propagates mapping persistence errors', async () => {
    const error = { message: 'constraint failure' };
    const upsert = vi.fn().mockResolvedValue({ error });
    const supabase = { from: vi.fn(() => ({ upsert })) };

    const result = await upsertJumiaImportMappings({
      supabase: supabase as never,
      rows: [],
    });

    expect(result).toEqual({ error });
  });
});

describe('persistJumiaImportEntries', () => {
  const entry = {
    sku: 'SKU-1',
    name: 'Test Product',
    description: 'A test product',
    price: 100,
    images: ['https://example.com/image.jpg'],
    productId: 'jumia-1',
  };

  function makeSupabase({
    productsResult = { data: [], error: null },
    mappingsError = null,
  }: {
    productsResult?: { data: unknown[] | null; error: unknown };
    mappingsError?: unknown;
  } = {}) {
    const productsUpsert = vi.fn(() => ({
      select: vi.fn().mockResolvedValue(productsResult),
    }));
    const mappingsUpsert = vi.fn().mockResolvedValue({ error: mappingsError });
    const supabase = {
      from: vi.fn((table: string) =>
        table === 'products'
          ? { upsert: productsUpsert }
          : { upsert: mappingsUpsert }
      ),
    };
    return { supabase: supabase as never, productsUpsert, mappingsUpsert };
  }

  function baseArgs(
    overrides: Partial<Parameters<typeof persistJumiaImportEntries>[0]> = {}
  ): Parameters<typeof persistJumiaImportEntries>[0] {
    return {
      supabase: {} as never,
      merchantId: 'merchant-1',
      shopId: 'shop-ng',
      marketplaceKey: 'NG',
      flatEntries: [entry],
      existingProducts: [],
      mappedSkus: new Set<string>(),
      ...overrides,
    };
  }

  it('links existing unmapped products without creating products', async () => {
    const { supabase, productsUpsert, mappingsUpsert } = makeSupabase();

    const result = await persistJumiaImportEntries(
      baseArgs({
        supabase,
        existingProducts: [{ id: 'product-1', sku: 'SKU-1' }],
      })
    );

    expect(result).toEqual({
      created: 0,
      linked: 1,
      errors: 0,
      warningMessages: [],
    });
    expect(productsUpsert).not.toHaveBeenCalled();
    expect(mappingsUpsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          merchant_id: 'merchant-1',
          product_id: 'product-1',
          jumia_sku: 'SKU-1',
          jumia_shop_id: 'shop-ng',
          marketplace_key: 'NG',
        }),
      ],
      expect.anything()
    );
  });

  it('creates missing products and counts them as created', async () => {
    const { supabase, productsUpsert, mappingsUpsert } = makeSupabase({
      productsResult: {
        data: [{ id: 'product-2', sku: 'SKU-1' }],
        error: null,
      },
    });

    const result = await persistJumiaImportEntries(baseArgs({ supabase }));

    expect(result).toEqual({
      created: 1,
      linked: 0,
      errors: 0,
      warningMessages: [],
    });
    expect(productsUpsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          merchant_id: 'merchant-1',
          sku: 'SKU-1',
          price: 100,
          stock_level: 0,
        }),
      ],
      { onConflict: 'merchant_id,sku' }
    );
    expect(mappingsUpsert).toHaveBeenCalledWith(
      [expect.objectContaining({ product_id: 'product-2' })],
      expect.anything()
    );
  });

  it('skips products that are already mapped', async () => {
    const { supabase, productsUpsert, mappingsUpsert } = makeSupabase();

    const result = await persistJumiaImportEntries(
      baseArgs({
        supabase,
        existingProducts: [{ id: 'product-1', sku: 'SKU-1' }],
        mappedSkus: new Set(['SKU-1']),
      })
    );

    expect(result).toEqual({
      created: 0,
      linked: 0,
      errors: 0,
      warningMessages: [],
    });
    expect(productsUpsert).not.toHaveBeenCalled();
    expect(mappingsUpsert).not.toHaveBeenCalled();
  });

  it('counts new products as errors when the product upsert fails', async () => {
    const { supabase, mappingsUpsert } = makeSupabase({
      productsResult: { data: null, error: { message: 'boom' } },
    });

    const result = await persistJumiaImportEntries(baseArgs({ supabase }));

    expect(result).toEqual({
      created: 0,
      linked: 0,
      errors: 1,
      warningMessages: [],
    });
    expect(mappingsUpsert).not.toHaveBeenCalled();
  });

  it('warns when products are created but the mapping upsert fails', async () => {
    const { supabase } = makeSupabase({
      productsResult: {
        data: [{ id: 'product-2', sku: 'SKU-1' }],
        error: null,
      },
      mappingsError: { message: 'constraint failure' },
    });

    const result = await persistJumiaImportEntries(baseArgs({ supabase }));

    expect(result).toEqual({
      created: 1,
      linked: 0,
      errors: 1,
      warningMessages: [
        '1 products created but mapping upsert failed; re-run to link',
      ],
    });
  });
});
