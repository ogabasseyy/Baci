import { describe, expect, it } from 'vitest';
import { getProductPriceRange } from './storefront-product-price-seo';

describe('getProductPriceRange inherited variant pricing', () => {
  it('uses the parent price for variants with inherited pricing', () => {
    const range = getProductPriceRange({
      name: 'Galaxy S25',
      has_variants: true,
      price: 150000,
      manage_stock: true,
      stock: 0,
      variants: [
        { price_override: null, stock_quantity: 2 },
        { price_override: 175000, stock_quantity: 2 },
      ],
    });

    expect(range).toEqual({
      min: 150000,
      max: 175000,
      hasRange: true,
    });
  });

  it('advertises an inherited parent price when every stocked variant is nullable', () => {
    const range = getProductPriceRange({
      name: 'Galaxy S25',
      has_variants: true,
      price: 150000,
      manage_stock: true,
      stock: 0,
      variants: [{ price_override: null, stock_quantity: 2 }],
    });

    expect(range).toEqual({
      min: 150000,
      max: 150000,
      hasRange: false,
    });
  });

  it('treats child quantities as informational for unmanaged parent stock', () => {
    const range = getProductPriceRange({
      name: 'iPad 10',
      has_variants: true,
      price: 150000,
      manage_stock: false,
      stock: 5,
      variants: [{ price_override: 175000, stock_quantity: 0 }],
    });

    expect(range).toEqual({
      min: 175000,
      max: 175000,
      hasRange: false,
    });
  });

  it('does not advertise an inherited variant price when the managed parent is empty', () => {
    const range = getProductPriceRange({
      name: 'Galaxy S25',
      has_variants: true,
      price: 150000,
      manage_stock: true,
      stock: 0,
      stock_quantity: 0,
      variants: [{ price_override: null, stock_quantity: null }],
    });

    expect(range).toBeNull();
  });
});
