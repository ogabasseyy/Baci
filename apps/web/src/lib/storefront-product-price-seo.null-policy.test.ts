import { describe, expect, it } from 'vitest';
import { getProductPriceRange } from '@/lib/storefront-product-price-seo';

describe('getProductPriceRange legacy null stock policy', () => {
  it('excludes depleted children under a null-policy parent (PDP parity)', () => {
    const range = getProductPriceRange({
      name: 'iPhone XR',
      price: 230000,
      manage_stock: null,
      stock: 0,
      has_variants: true,
      variants: [
        { price_override: 100000, stock_quantity: 0 },
        { price_override: 210000, stock_quantity: 2 },
      ],
      offers: [
        { price: 90000, status: 'active', stock_quantity: 0 },
        { price: 220000, status: 'active', stock_quantity: 1 },
      ],
    });

    expect(range).toEqual({
      min: 210000,
      max: 220000,
      hasRange: true,
    });
  });

  it('advertises no price for a depleted simple product under a null policy', () => {
    expect(
      getProductPriceRange({
        name: 'iPhone XR',
        price: 230000,
        manage_stock: null,
        stock: 0,
        stock_quantity: 0,
      })
    ).toBeNull();
  });

  it('keeps unlimited semantics for an explicit false policy', () => {
    expect(
      getProductPriceRange({
        name: 'iPhone XR',
        price: 230000,
        manage_stock: false,
        stock: 0,
        has_variants: true,
        variants: [{ price_override: 100000, stock_quantity: 0 }],
      })
    ).toEqual({ min: 100000, max: 100000, hasRange: false });
  });
});
