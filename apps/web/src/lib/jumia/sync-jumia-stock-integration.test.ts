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
    eq: vi.fn((column: string) =>
      column === 'sync_status'
        ? Promise.resolve({ data: rows, error: null })
        : query
    ),
  };
  return query;
}

function inQuery(rows: unknown[]) {
  return {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({ data: rows, error: null }),
  };
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
    const upsert = vi.fn().mockResolvedValue({ error: null });
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
          return { ...query, upsert };
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
    expect(upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: 'mapping-1',
          baci_stock_at_last_sync: 5,
          last_feed_id: 'feed-1',
        }),
      ],
      { onConflict: 'id', ignoreDuplicates: false }
    );
    expect(result).toEqual({
      updated: 1,
      skipped: 0,
      trackingFailures: 0,
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
