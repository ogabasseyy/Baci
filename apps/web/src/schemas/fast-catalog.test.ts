import { describe, expect, it } from 'vitest';
import {
  fastCatalogProductRowSchema,
  fastCatalogVariantRowSchema,
} from './fast-catalog';

const product = {
  id: 'product-1',
  merchant_id: 'merchant-1',
  category_id: null,
  name: 'AirPods Max',
  brand: 'Apple',
  category: null,
  description: null,
  images: [],
  price: 100_000,
  status: 'active',
  stock: null,
  stock_quantity: null,
  manage_stock: null,
  has_variants: null,
  has_condition_offers: null,
  variant_model: null,
};

describe('fast catalog row validation', () => {
  it('accepts nullable legacy stock flags and preserves extra catalog fields', () => {
    const result = fastCatalogProductRowSchema.parse({
      ...product,
      merchant_extension: 'retained',
    });
    expect(result.manage_stock).toBeNull();
    expect(result.merchant_extension).toBe('retained');
  });

  it('rejects incomplete products and non-finite prices', () => {
    expect(
      fastCatalogProductRowSchema.safeParse({ ...product, id: '' }).success
    ).toBe(false);
    expect(
      fastCatalogProductRowSchema.safeParse({ ...product, price: Number.NaN })
        .success
    ).toBe(false);
  });

  it('accepts supported option fields and rejects malformed stock', () => {
    expect(
      fastCatalogVariantRowSchema.safeParse({
        id: 'variant-1',
        product_id: 'product-1',
        price_override: '120000',
        stock_quantity: 2,
      }).success
    ).toBe(true);
    expect(
      fastCatalogVariantRowSchema.safeParse({
        id: 'variant-1',
        product_id: 'product-1',
        stock_quantity: 'many',
      }).success
    ).toBe(false);
  });
});
