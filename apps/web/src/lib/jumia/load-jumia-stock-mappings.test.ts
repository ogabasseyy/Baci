import { describe, expect, it, vi } from 'vitest';
import {
  getPushReadyJumiaStockMappings,
  loadJumiaStockMappings,
} from './load-jumia-stock-mappings';

describe('loadJumiaStockMappings', () => {
  function pagedQuery(pages: unknown[][]) {
    const query: Record<string, ReturnType<typeof vi.fn>> = {
      eq: vi.fn(() => query),
      or: vi.fn(() => query),
      order: vi.fn(() => query),
      select: vi.fn(),
      range: vi.fn((start: number) =>
        Promise.resolve({
          data: pages[Math.floor(start / 500)] ?? [],
          error: null,
        })
      ),
    };
    query.select.mockReturnValue(query);
    return query;
  }

  it('scopes mapping discovery to the merchant marketplace', async () => {
    const query = pagedQuery([[]]);
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
    expect(query.order).toHaveBeenCalledWith('id', { ascending: true });
  });

  it('excludes deactivated and inventory-opted-out mappings', async () => {
    const query = pagedQuery([[]]);
    const supabase = {
      from: vi.fn(() => query),
    } as never;

    await loadJumiaStockMappings(supabase, {
      merchantId: 'merchant-1',
      shopId: 'shop-1',
      marketplaceKey: 'NG-1',
    });

    expect(query.or).toHaveBeenCalledWith(
      'is_active.is.null,is_active.eq.true'
    );
    expect(query.or).toHaveBeenCalledWith(
      'sync_inventory.is.null,sync_inventory.eq.true'
    );
  });

  it('loads deterministic pages past the response cap', async () => {
    const first = Array.from({ length: 500 }, (_, index) => ({
      id: `mapping-${index}`,
    }));
    const second = [{ id: 'mapping-500' }];
    const query = pagedQuery([first, second]);
    const supabase = {
      from: vi.fn(() => query),
    } as never;

    const result = await loadJumiaStockMappings(supabase, {
      merchantId: 'merchant-1',
      shopId: 'shop-1',
      marketplaceKey: 'NG-1',
    });

    expect(result.error).toBeNull();
    expect(result.mappings).toHaveLength(501);
    expect(query.range).toHaveBeenCalledWith(0, 499);
    expect(query.range).toHaveBeenCalledWith(500, 999);
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
