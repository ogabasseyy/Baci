import { describe, expect, it, vi } from 'vitest';
import { loadCheckoutCatalog } from './checkout-catalog';

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222';

function chain(data: unknown, error: unknown = null) {
  const query = {
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    returns: vi.fn(async () => ({ data, error })),
    select: vi.fn(() => query),
  };
  return query;
}

describe('loadCheckoutCatalog', () => {
  it('skips lookups for non-UUID external ids', async () => {
    const from = vi.fn();
    const result = await loadCheckoutCatalog(
      { from } as never,
      [{ id: 'sku-1', quantity: 1 }],
      MERCHANT_ID
    );
    expect(result).toEqual({ products: [], variants: [] });
    expect(from).not.toHaveBeenCalled();
  });

  it('fails when the product lookup errors', async () => {
    const supabase = {
      from: vi.fn((table: string) =>
        table === 'products' ? chain(null, new Error('db down')) : chain([])
      ),
    };
    await expect(
      loadCheckoutCatalog(
        supabase as never,
        [{ id: PRODUCT_ID, quantity: 1 }],
        MERCHANT_ID
      )
    ).rejects.toThrow('Failed to load checkout products');
  });
});
