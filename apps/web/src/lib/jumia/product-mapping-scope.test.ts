import { describe, expect, it, vi } from 'vitest';
import {
  type IntegrationScopedMapping,
  loadIntegrationScopedMappings,
  pickPrimaryProductMapping,
} from './product-mapping-scope';

function mapping(
  overrides: Partial<IntegrationScopedMapping> & { id: string }
): IntegrationScopedMapping {
  return {
    product_id: 'product-1',
    variant_id: null,
    jumia_sku: 'SKU-1',
    jumia_seller_sku: 'SKU-1',
    jumia_product_id: 'JUMIA-1',
    jumia_price: 1000,
    jumia_sale_price: null,
    jumia_sale_start: null,
    jumia_sale_end: null,
    is_active: true,
    sync_inventory: true,
    sync_price: false,
    sync_status: 'synced',
    last_synced_at: null,
    sync_error: null,
    created_at: '2026-08-13T10:00:00Z',
    updated_at: '2026-08-13T10:00:00Z',
    ...overrides,
  };
}

describe('loadIntegrationScopedMappings', () => {
  it('scopes mappings by product, merchant, shop, and marketplace key', async () => {
    const filters: Array<{ field: string; value: unknown }> = [];
    const order = vi.fn().mockResolvedValue({ data: [], error: null });
    const chain = {
      eq: vi.fn(function (this: typeof chain, field: string, value: unknown) {
        filters.push({ field, value });
        return this;
      }),
      order,
    };
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue(chain),
      }),
    };

    const { mappings, error } = await loadIntegrationScopedMappings({
      supabase: supabase as never,
      merchantId: 'merchant-1',
      productId: 'product-1',
      shopId: 'shop-1',
      marketplaceKey: 'GH',
    });

    expect(error).toBeNull();
    expect(mappings).toEqual([]);
    expect(filters).toEqual(
      expect.arrayContaining([
        { field: 'product_id', value: 'product-1' },
        { field: 'merchant_id', value: 'merchant-1' },
        { field: 'jumia_shop_id', value: 'shop-1' },
        { field: 'marketplace_key', value: 'GH' },
      ])
    );
    expect(order).toHaveBeenCalledWith('created_at', { ascending: true });
  });

  it('returns query errors as Error instances', async () => {
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'permission denied' },
          }),
        }),
      }),
    };

    const { mappings, error } = await loadIntegrationScopedMappings({
      supabase: supabase as never,
      merchantId: 'merchant-1',
      productId: 'product-1',
      shopId: 'shop-1',
      marketplaceKey: 'default',
    });

    expect(mappings).toEqual([]);
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe('permission denied');
  });
});

describe('pickPrimaryProductMapping', () => {
  it('returns null when no mappings exist', () => {
    expect(pickPrimaryProductMapping([])).toBeNull();
  });

  it('prefers the simple-product mapping without a variant id', () => {
    const primary = mapping({ id: 'map-primary', variant_id: null });
    const variant = mapping({
      id: 'map-variant',
      variant_id: 'variant-1',
      jumia_sku: 'SKU-2',
    });

    expect(pickPrimaryProductMapping([variant, primary])).toEqual(primary);
  });

  it('falls back to the first mapping when every row is variant-scoped', () => {
    const first = mapping({
      id: 'map-first',
      variant_id: 'variant-1',
      jumia_sku: 'SKU-1',
    });
    const second = mapping({
      id: 'map-second',
      variant_id: 'variant-2',
      jumia_sku: 'SKU-2',
    });

    expect(pickPrimaryProductMapping([first, second])).toEqual(first);
  });
});
