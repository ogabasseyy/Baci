import { describe, expect, it, vi } from 'vitest';
import {
  getPushReadyJumiaStockMappings,
  loadJumiaStockMappings,
} from './load-jumia-stock-mappings';

describe('loadJumiaStockMappings', () => {
  it('scopes mapping discovery to the merchant marketplace', async () => {
    const query = {
      eq: vi.fn((column: string) =>
        column === 'sync_status'
          ? Promise.resolve({ data: [], error: null })
          : query
      ),
      select: vi.fn(),
    };
    query.select.mockReturnValue(query);
    const supabase = {
      from: vi.fn(() => query),
    } as never;

    await expect(
      loadJumiaStockMappings(supabase, {
        merchantId: 'merchant-1',
        shopId: 'shop-1',
        marketplaceKey: 'NG-1',
      })
    ).resolves.toEqual({ mappings: [], error: null });
    expect(query.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(query.eq).toHaveBeenCalledWith('jumia_shop_id', 'shop-1');
    expect(query.eq).toHaveBeenCalledWith('marketplace_key', 'NG-1');
    expect(query.eq).toHaveBeenCalledWith('sync_status', 'synced');
  });

  it('returns only mappings with provider identifiers as push-ready', () => {
    const { pushReady, skipped } = getPushReadyJumiaStockMappings([
      {
        id: 'mapping-1',
        product_id: 'product-1',
        variant_id: null,
        jumia_seller_sku: 'sku-1',
        jumia_product_id: 'jumia-1',
        baci_stock_at_last_sync: 1,
      },
      {
        id: 'mapping-2',
        product_id: 'product-2',
        variant_id: null,
        jumia_seller_sku: null,
        jumia_product_id: 'jumia-2',
        baci_stock_at_last_sync: 1,
      },
    ]);

    expect(pushReady).toHaveLength(1);
    expect(skipped).toBe(1);
  });
});
