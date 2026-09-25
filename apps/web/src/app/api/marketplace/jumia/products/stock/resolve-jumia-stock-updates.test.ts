import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JumiaStockMapping } from '@/lib/jumia/load-jumia-stock-mappings';
import { resolveJumiaStockUpdates } from './resolve-jumia-stock-updates';

const mockVariantsIn = vi.fn();
const mockProductsIn = vi.fn();

function supabase() {
  return {
    from: vi.fn((table: string) => {
      if (table === 'product_variants') {
        return {
          select: () => ({
            eq: () => ({ in: (...args: unknown[]) => mockVariantsIn(...args) }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({ in: (...args: unknown[]) => mockProductsIn(...args) }),
        }),
      };
    }),
  } as never;
}

function mapping(overrides: Partial<JumiaStockMapping>): JumiaStockMapping {
  return {
    id: 'mapping-1',
    product_id: 'product-1',
    variant_id: null,
    jumia_seller_sku: 'SKU-1',
    jumia_product_id: 'jumia-1',
    baci_stock_at_last_sync: 2,
    last_feed_id: null,
    ...overrides,
  };
}

describe('resolveJumiaStockUpdates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns updates for changed stock and skips the rest', async () => {
    mockVariantsIn.mockResolvedValue({
      data: [{ id: 'variant-1', stock_quantity: 8 }],
      error: null,
    });
    mockProductsIn.mockResolvedValue({
      data: [{ id: 'product-1', stock: 0, stock_quantity: 10 }],
      error: null,
    });

    const result = await resolveJumiaStockUpdates(supabase(), 'merchant-1', [
      mapping({ id: 'mapping-changed' }),
      mapping({
        id: 'mapping-unchanged',
        product_id: 'product-1',
        baci_stock_at_last_sync: 10,
      }),
      mapping({
        id: 'mapping-variant',
        product_id: 'product-2',
        variant_id: 'variant-1',
        jumia_seller_sku: 'SKU-V1',
        jumia_product_id: 'jumia-v1',
        baci_stock_at_last_sync: 3,
      }),
      mapping({
        id: 'mapping-missing-stock',
        product_id: 'product-gone',
        baci_stock_at_last_sync: 1,
      }),
    ]);

    expect(result.stockUpdates).toEqual([
      {
        mappingId: 'mapping-changed',
        sellerSku: 'SKU-1',
        id: 'jumia-1',
        stock: 10,
      },
      {
        mappingId: 'mapping-variant',
        sellerSku: 'SKU-V1',
        id: 'jumia-v1',
        stock: 8,
      },
    ]);
    // Unchanged cursors are not counted as skipped; only missing stock is.
    expect(result.skipped).toBe(1);
    expect(result.fetchErrors).toBe(0);
  });

  it('counts lookup failures without failing the resolution', async () => {
    mockVariantsIn.mockResolvedValue({
      data: null,
      error: { message: 'variants unavailable' },
    });
    mockProductsIn.mockResolvedValue({
      data: [{ id: 'product-1', stock: 0, stock_quantity: 10 }],
      error: null,
    });

    const result = await resolveJumiaStockUpdates(supabase(), 'merchant-1', [
      mapping({ id: 'mapping-product' }),
      mapping({
        id: 'mapping-variant',
        product_id: 'product-2',
        variant_id: 'variant-1',
        baci_stock_at_last_sync: 3,
      }),
    ]);

    expect(result.fetchErrors).toBe(1);
    expect(result.stockUpdates).toEqual([
      {
        mappingId: 'mapping-product',
        sellerSku: 'SKU-1',
        id: 'jumia-1',
        stock: 10,
      },
    ]);
    expect(result.skipped).toBe(1);
  });

  it('chunks lookups past the PostgREST filter budget', async () => {
    mockVariantsIn.mockImplementation((_field: string, ids: string[]) =>
      Promise.resolve({
        data: ids.map((id) => ({ id, stock_quantity: 4 })),
        error: null,
      })
    );
    mockProductsIn.mockResolvedValue({ data: [], error: null });
    const pushReady = Array.from({ length: 101 }, (_, index) =>
      mapping({
        id: `mapping-${index}`,
        product_id: `product-${index}`,
        variant_id: `variant-${index}`,
        baci_stock_at_last_sync: 2,
      })
    );

    const result = await resolveJumiaStockUpdates(
      supabase(),
      'merchant-1',
      pushReady
    );

    expect(mockVariantsIn).toHaveBeenCalledTimes(2);
    expect(result.stockUpdates).toHaveLength(101);
    expect(result.fetchErrors).toBe(0);
  });
});
