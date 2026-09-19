import { describe, expect, it, vi } from 'vitest';
import type { RelatedBlogProduct } from '@/lib/related-blog-products';
import { hydrateRelatedBlogProductAvailability } from './hydrate-related-blog-product-availability';

function product(
  overrides: Partial<RelatedBlogProduct> = {}
): RelatedBlogProduct {
  return {
    id: 'product-1',
    name: 'iPhone 16',
    slug: 'iphone-16',
    category_slug: 'smartphones',
    manage_stock: true,
    stock: 0,
    has_condition_offers: true,
    ...overrides,
  };
}

const VARIANT_PRODUCT_ID = '123e4567-e89b-12d3-a456-426614174000';

describe('hydrateRelatedBlogProductAvailability', () => {
  it('marks an empty primary product as available when an active condition offer has stock', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ stock_quantity: 2 }],
      error: null,
    });

    const result = await hydrateRelatedBlogProductAvailability(
      { rpc } as never,
      [product()]
    );

    expect(result[0]?.has_purchasable_condition_offer).toBe(true);
    expect(rpc).toHaveBeenCalledWith('get_product_offers', {
      p_product_id: 'product-1',
    });
  });

  it('marks an empty primary product unavailable when every active offer is empty', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ stock_quantity: 0 }, { stock_quantity: null }],
      error: null,
    });

    const result = await hydrateRelatedBlogProductAvailability(
      { rpc } as never,
      [product()]
    );

    expect(result[0]?.has_purchasable_condition_offer).toBe(false);
  });

  it('does not read offers for products that are not currently unavailable', async () => {
    const rpc = vi.fn();
    const products = [
      product({ stock_quantity: 3, has_condition_offers: false }),
      product({
        id: 'product-2',
        manage_stock: false,
        has_condition_offers: false,
      }),
      product({ id: 'product-3', has_condition_offers: false }),
    ];

    const result = await hydrateRelatedBlogProductAvailability(
      { rpc } as never,
      products
    );

    expect(rpc).not.toHaveBeenCalled();
    expect(result).toEqual(products);
  });

  it('hydrates condition offers while primary stock is positive', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const stockedVariantProduct = product({
      stock: 3,
      stock_quantity: 3,
      has_condition_offers: true,
      has_variants: true,
      id: VARIANT_PRODUCT_ID,
    });

    const result = await hydrateRelatedBlogProductAvailability(
      { rpc } as never,
      [stockedVariantProduct]
    );

    expect(rpc).toHaveBeenCalledWith('get_product_offers', {
      p_product_id: VARIANT_PRODUCT_ID,
    });
    expect(result[0]).toMatchObject({
      ...stockedVariantProduct,
      has_purchasable_condition_offer: false,
      offers: [],
    });
  });

  it('hydrates condition-offer prices even while the parent stock is positive', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ price: 175000, stock_quantity: 2 }],
      error: null,
    });
    const stockedProduct = product({
      stock: 3,
      stock_quantity: 3,
      price: 150000,
    });

    const result = await hydrateRelatedBlogProductAvailability(
      { rpc } as never,
      [stockedProduct]
    );

    expect(result[0]?.offers).toEqual([
      { price: 175000, status: 'active', stock_quantity: 2 },
    ]);
    expect(rpc).toHaveBeenCalledWith('get_product_offers', {
      p_product_id: 'product-1',
    });
  });

  it('keeps the current purchasable offer price for the related rail', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ price: '175000', stock_quantity: '2' }],
      error: null,
    });

    const result = await hydrateRelatedBlogProductAvailability(
      { rpc } as never,
      [product({ price: 150000 })]
    );

    expect(result[0]?.offers).toEqual([
      { price: 175000, status: 'active', stock_quantity: 2 },
    ]);
  });

  it('fails open when the offer lookup errors', async () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'timeout' },
    });

    try {
      const result = await hydrateRelatedBlogProductAvailability(
        { rpc } as never,
        [product()]
      );

      expect(result[0]?.has_purchasable_condition_offer).toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('surfaces alternate lookup failures when the caller cannot cache degraded data', async () => {
    const lookupError = { message: 'transient timeout' };
    const rpc = vi.fn().mockResolvedValue({ data: null, error: lookupError });

    await expect(
      hydrateRelatedBlogProductAvailability({ rpc } as never, [product()], {
        throwOnError: true,
      })
    ).rejects.toEqual(lookupError);
  });
});
