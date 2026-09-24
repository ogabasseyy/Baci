import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  forIntegration: vi.fn(),
  updateStock: vi.fn(),
}));

vi.mock('@/lib/jumia/client', () => ({
  JumiaClient: {
    forIntegration: mocks.forIntegration,
  },
}));

vi.mock('@/lib/jumia/feeds', () => ({
  updateStock: mocks.updateStock,
}));

import { syncJumiaStockForIntegration } from './sync-jumia-stock-integration';

function mappingsQuery(rows: unknown[]) {
  const query: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn(() => query),
    or: vi.fn(() => query),
    order: vi.fn(() => query),
    range: vi.fn(() => Promise.resolve({ data: rows, error: null })),
  };
  return query;
}

function inQuery(rows: unknown[]) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn(() => query),
    in: vi.fn().mockResolvedValue({ data: rows, error: null }),
  };
  return query;
}

describe('syncJumiaStockForIntegration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.forIntegration.mockResolvedValue({
      shopId: 'shop-1',
      marketplaceKey: 'key-1',
    });
    mocks.updateStock.mockResolvedValue('feed-1');
  });

  it('pushes changed stock and records tracking', async () => {
    const update = vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({ error: null }),
    }));
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'jumia_product_mappings') {
          const query = mappingsQuery([
            {
              id: 'mapping-1',
              product_id: 'product-1',
              variant_id: null,
              jumia_seller_sku: 'SKU-1',
              jumia_product_id: 'pid-1',
              baci_stock_at_last_sync: 2,
            },
          ]);
          return { ...query, update };
        }
        return inQuery([{ id: 'product-1', stock: 5, stock_quantity: 5 }]);
      }),
    };

    const result = await syncJumiaStockForIntegration({
      supabase: supabase as never,
      merchantId: 'merchant-1',
      integrationId: 'integration-1',
    });

    expect(mocks.updateStock).toHaveBeenCalledWith(
      expect.objectContaining({ shopId: 'shop-1' }),
      [{ sellerSku: 'SKU-1', id: 'pid-1', stock: 5 }]
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        baci_stock_at_last_sync: 5,
        last_feed_id: 'feed-1',
      })
    );
    expect(result).toEqual({
      updated: 1,
      skipped: 0,
      trackingFailures: 0,
      feedId: 'feed-1',
    });
  });

  it('forwards the restricted credential client to the Jumia client', async () => {
    const update = vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({ error: null }),
    }));
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'jumia_product_mappings') {
          const query = mappingsQuery([
            {
              id: 'mapping-1',
              product_id: 'product-1',
              variant_id: null,
              jumia_seller_sku: 'SKU-1',
              jumia_product_id: 'pid-1',
              baci_stock_at_last_sync: 2,
            },
          ]);
          return { ...query, update };
        }
        return inQuery([{ id: 'product-1', stock: 5, stock_quantity: 5 }]);
      }),
    };
    const credentialClient = { credential: true };

    await syncJumiaStockForIntegration({
      supabase: supabase as never,
      merchantId: 'merchant-1',
      integrationId: 'integration-1',
      credentialClient: credentialClient as never,
    });

    expect(mocks.forIntegration).toHaveBeenCalledWith(
      supabase,
      'merchant-1',
      'integration-1',
      { credentialClient }
    );
  });

  it('scopes privileged stock lookups to the mapping merchant', async () => {
    const update = vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({ error: null }),
    }));
    const variantsQuery = inQuery([{ id: 'variant-1', stock_quantity: 7 }]);
    const productsQuery = inQuery([
      { id: 'product-1', stock: 5, stock_quantity: 5 },
    ]);
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'jumia_product_mappings') {
          const query = mappingsQuery([
            {
              id: 'mapping-1',
              product_id: 'product-1',
              variant_id: 'variant-1',
              jumia_seller_sku: 'SKU-1',
              jumia_product_id: 'pid-1',
              baci_stock_at_last_sync: 2,
            },
            {
              id: 'mapping-2',
              product_id: 'product-1',
              variant_id: null,
              jumia_seller_sku: 'SKU-2',
              jumia_product_id: 'pid-2',
              baci_stock_at_last_sync: 2,
            },
          ]);
          return { ...query, update };
        }
        if (table === 'product_variants') return variantsQuery;
        return productsQuery;
      }),
    };

    await syncJumiaStockForIntegration({
      supabase: supabase as never,
      merchantId: 'merchant-1',
      integrationId: 'integration-1',
    });

    expect(variantsQuery.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(productsQuery.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(mocks.updateStock).toHaveBeenCalledWith(
      expect.objectContaining({ shopId: 'shop-1' }),
      [
        { sellerSku: 'SKU-1', id: 'pid-1', stock: 7 },
        { sellerSku: 'SKU-2', id: 'pid-2', stock: 5 },
      ]
    );
  });

  it('chunks large stock lookups within URL limits', async () => {
    const update = vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({ error: null }),
    }));
    const mappings = Array.from({ length: 250 }, (_, index) => ({
      id: `mapping-${index}`,
      product_id: `product-${index}`,
      variant_id: null,
      jumia_seller_sku: `SKU-${index}`,
      jumia_product_id: `pid-${index}`,
      baci_stock_at_last_sync: 2,
    }));
    const productsIn = vi.fn((_field: string, ids: string[]) =>
      Promise.resolve({
        data: ids.map((id) => ({ id, stock: 5, stock_quantity: 5 })),
        error: null,
      })
    );
    const productsQuery: Record<string, ReturnType<typeof vi.fn>> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn(() => productsQuery),
      in: productsIn,
    };
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'jumia_product_mappings') {
          const query = mappingsQuery(mappings);
          return { ...query, update };
        }
        return productsQuery;
      }),
    };

    const result = await syncJumiaStockForIntegration({
      supabase: supabase as never,
      merchantId: 'merchant-1',
      integrationId: 'integration-1',
    });

    expect(productsIn).toHaveBeenCalledTimes(3);
    expect(productsIn.mock.calls[0]?.[1]).toHaveLength(100);
    expect(productsIn.mock.calls[2]?.[1]).toHaveLength(50);
    expect(result.updated).toBe(250);
  });

  it('propagates tracking failures without failing the sync', async () => {
    const update = vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({ error: { message: 'denied' } }),
    }));
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'jumia_product_mappings') {
          const query = mappingsQuery([
            {
              id: 'mapping-1',
              product_id: 'product-1',
              variant_id: null,
              jumia_seller_sku: 'SKU-1',
              jumia_product_id: 'pid-1',
              baci_stock_at_last_sync: 2,
            },
          ]);
          return { ...query, update };
        }
        return inQuery([{ id: 'product-1', stock: 5, stock_quantity: 5 }]);
      }),
    };

    const result = await syncJumiaStockForIntegration({
      supabase: supabase as never,
      merchantId: 'merchant-1',
      integrationId: 'integration-1',
    });

    expect(result).toEqual({
      updated: 1,
      skipped: 0,
      trackingFailures: 1,
      feedId: 'feed-1',
    });
  });

  it('skips unchanged stock without calling the provider', async () => {
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'jumia_product_mappings') {
          return mappingsQuery([
            {
              id: 'mapping-1',
              product_id: 'product-1',
              variant_id: null,
              jumia_seller_sku: 'SKU-1',
              jumia_product_id: 'pid-1',
              baci_stock_at_last_sync: 5,
            },
          ]);
        }
        return inQuery([{ id: 'product-1', stock: 5, stock_quantity: 5 }]);
      }),
    };

    const result = await syncJumiaStockForIntegration({
      supabase: supabase as never,
      merchantId: 'merchant-1',
      integrationId: 'integration-1',
    });

    expect(mocks.updateStock).not.toHaveBeenCalled();
    expect(result).toEqual({
      updated: 0,
      skipped: 0,
      trackingFailures: 0,
      feedId: null,
    });
  });

  it('returns empty when no mappings are synced', async () => {
    const supabase = {
      from: vi.fn(() => mappingsQuery([])),
    };

    const result = await syncJumiaStockForIntegration({
      supabase: supabase as never,
      merchantId: 'merchant-1',
      integrationId: 'integration-1',
    });

    expect(mocks.updateStock).not.toHaveBeenCalled();
    expect(result.feedId).toBeNull();
    expect(result.updated).toBe(0);
  });
});
