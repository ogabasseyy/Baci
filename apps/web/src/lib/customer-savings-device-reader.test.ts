import { describe, expect, it, vi } from 'vitest';
import {
  readSavingsDeviceProduct,
  type SavingsDeviceQueryClient,
} from './customer-savings-device-reader';

function fixture(error: unknown = null) {
  const chain = {
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => ({
      data: { id: 'product', name: 'Phone', price: 100 },
      error,
    })),
  };
  const rpc = vi.fn(async () => ({
    data: [
      { id: 'owned', product_id: 'product' },
      { id: 'other', product_id: 'unrelated' },
    ],
    error: null,
  }));
  const client: SavingsDeviceQueryClient = {
    from: () => ({ select: () => chain }),
    rpc,
  };
  return { chain, client, rpc };
}

describe('readSavingsDeviceProduct', () => {
  it('scopes the product and filters RPC variants to the requested product', async () => {
    const { client, chain, rpc } = fixture();
    const product = await readSavingsDeviceProduct({
      merchantId: 'merchant',
      productId: 'product',
      supabase: client,
    });
    expect(chain.eq).toHaveBeenCalledWith('merchant_id', 'merchant');
    expect(chain.eq).toHaveBeenCalledWith('status', 'active');
    expect(rpc).toHaveBeenCalledWith('get_storefront_product_variants', {
      p_product_ids: ['product'],
    });
    expect(product?.variants?.map((variant) => variant.id)).toEqual(['owned']);
  });

  it('propagates product query errors without fetching variants', async () => {
    const failure = new Error('unavailable');
    const { client, rpc } = fixture(failure);
    await expect(
      readSavingsDeviceProduct({
        merchantId: 'merchant',
        productId: 'product',
        supabase: client,
      })
    ).rejects.toBe(failure);
    expect(rpc).not.toHaveBeenCalled();
  });
});
