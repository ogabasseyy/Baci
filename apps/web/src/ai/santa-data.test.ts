import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createPublicClient: vi.fn() }));

vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock('@/lib/supabase/public', () => ({
  createPublicClient: mocks.createPublicClient,
}));

import {
  getCachedSantaProductList,
  getCachedSantaProducts,
  selectSantaCatalogProducts,
} from './santa-data';

function mockProducts(data: unknown) {
  const rpc = vi.fn().mockResolvedValue({ data, error: null });
  mocks.createPublicClient.mockReturnValue({ rpc });
  return { rpc };
}

describe('Santa catalog data', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses the public RLS client and applies checkout-compatible offer limits', async () => {
    const { rpc } = mockProducts([
      {
        brand: 'Apple',
        max_margin_discount_percentage: 40,
        name: 'Phone',
        price: 100_000,
      },
    ]);

    await expect(
      getCachedSantaProductList('merchant-1', true)
    ).resolves.toEqual([
      {
        brand: 'Apple',
        max_discount_percentage: 2,
        max_margin_discount_percentage: 40,
        name: 'Phone',
        price: 100_000,
      },
    ]);
    expect(mocks.createPublicClient).toHaveBeenCalledWith({
      clientInfo: 'baci-santa-catalog',
    });
    expect(rpc).toHaveBeenCalledWith('get_santa_catalog', {
      p_merchant_id: 'merchant-1',
    });
  });

  it('does not offer a discount when negotiation is disabled or the product is ineligible', async () => {
    mockProducts([
      {
        brand: 'Tecno',
        max_margin_discount_percentage: 40,
        name: 'Spark 50',
        price: 100_000,
      },
    ]);

    await expect(
      getCachedSantaProducts('merchant-1', true, 'NGN')
    ).resolves.toContain('Spark 50": ₦100,000 (Maximum Discount: 0%)');
    await expect(
      getCachedSantaProducts('merchant-1', false, 'NGN')
    ).resolves.toContain('Spark 50": ₦100,000 (Maximum Discount: 0%)');
  });

  it('keeps a margin-protected product at zero even when checkout allows negotiation', async () => {
    mockProducts([
      {
        brand: 'Apple',
        max_margin_discount_percentage: 0,
        name: 'High-cost Phone',
        price: 100_000,
      },
    ]);
    await expect(
      getCachedSantaProducts('merchant-1', true, 'NGN')
    ).resolves.toContain('High-cost Phone": ₦100,000 (Maximum Discount: 0%)');
  });

  it('samples across the price range without absolute currency thresholds', () => {
    const products = Array.from({ length: 16 }, (_, index) => ({
      brand: 'Acme',
      max_discount_percentage: 2,
      max_margin_discount_percentage: 40,
      name: `Product ${index}`,
      // Small-unit currency scale (e.g. USD): every product sits far below
      // the old NGN bucket thresholds.
      price: 100 * (index + 1),
    }));

    const selected = selectSantaCatalogProducts(products);

    expect(selected).toHaveLength(16);
    expect(selected.map((product) => product.price)).toEqual(
      [...selected.map((product) => product.price)].sort((a, b) => b - a)
    );
    expect(selected.at(-1)?.price).toBe(100);

    expect(selectSantaCatalogProducts([])).toEqual([]);
  });
});
