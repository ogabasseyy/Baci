import { describe, expect, it, vi } from 'vitest';
import { PRODUCT_COLUMNS, PRODUCT_COLUMNS_PUBLIC } from '@/lib/product-queries';
import { refreshUpdatedProduct } from './refresh-updated-product';

function createSupabaseMock(result: {
  data: Record<string, unknown> | null;
  error: { message: string } | null;
}) {
  const select = vi.fn();
  const eq = vi.fn();
  const single = vi.fn(() => Promise.resolve(result));
  const chain = { select, eq, single };
  select.mockReturnValue(chain);
  eq.mockReturnValue(chain);
  const from = vi.fn(() => chain);
  return {
    supabase: { from } as unknown as Parameters<
      typeof refreshUpdatedProduct
    >[0]['supabase'],
    from,
    select,
    eq,
  };
}

describe('refreshUpdatedProduct', () => {
  const fallbackProduct = {
    id: 'prod-1',
    name: 'Fallback Phone',
    slug: 'fallback-phone',
  };

  it('reads merchant_products with PRODUCT_COLUMNS when canViewProducts is true', async () => {
    const refreshed = {
      id: 'prod-1',
      name: 'Refreshed Phone',
      slug: 'refreshed-phone',
      cost_price: 500,
    };
    const { supabase, from, select, eq } = createSupabaseMock({
      data: refreshed,
      error: null,
    });

    const result = await refreshUpdatedProduct({
      supabase,
      productId: 'prod-1',
      merchantId: 'merch-1',
      canViewProducts: true,
      fallbackProduct,
    });

    expect(from).toHaveBeenCalledWith('merchant_products');
    expect(select).toHaveBeenCalledWith(PRODUCT_COLUMNS);
    expect(eq).toHaveBeenNthCalledWith(1, 'id', 'prod-1');
    expect(eq).toHaveBeenNthCalledWith(2, 'merchant_id', 'merch-1');
    expect(result).toEqual({ updatedProduct: refreshed, refreshFailed: false });
  });

  it('reads public products with PRODUCT_COLUMNS_PUBLIC when canViewProducts is false', async () => {
    const refreshed = {
      id: 'prod-1',
      name: 'Public Phone',
      slug: 'public-phone',
    };
    const { supabase, from, select } = createSupabaseMock({
      data: refreshed,
      error: null,
    });

    const result = await refreshUpdatedProduct({
      supabase,
      productId: 'prod-1',
      merchantId: 'merch-1',
      canViewProducts: false,
      fallbackProduct,
    });

    expect(from).toHaveBeenCalledWith('products');
    expect(select).toHaveBeenCalledWith(PRODUCT_COLUMNS_PUBLIC);
    expect(result).toEqual({ updatedProduct: refreshed, refreshFailed: false });
  });

  it('falls back to fallbackProduct and marks refreshFailed when the read fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { supabase } = createSupabaseMock({
        data: null,
        error: { message: 'boom' },
      });

      const result = await refreshUpdatedProduct({
        supabase,
        productId: 'prod-1',
        merchantId: 'merch-1',
        canViewProducts: true,
        fallbackProduct,
      });

      expect(result).toEqual({
        updatedProduct: fallbackProduct,
        refreshFailed: true,
      });
      expect(errorSpy).toHaveBeenCalledWith(
        'Error refreshing updated product:',
        { message: 'boom' }
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});
