import { describe, expect, it } from 'vitest';
import { storefrontProductsQuerySchema } from '@/schemas/storefront-products-query';

const VALID_MERCHANT_ID = '00000000-0000-4000-8000-000000000001';

describe('storefrontProductsQuerySchema', () => {
  it('accepts a valid storefront products query', () => {
    const result = storefrontProductsQuerySchema.safeParse({
      merchant_id: VALID_MERCHANT_ID,
      category: 'smart-tvs',
      brand: 'Sony',
      condition: 'refurbished',
      min_price: '1000',
      max_price: '9000',
      offset: '50',
      sort: 'price-asc',
      q: 'bravia',
      has_images: 'true',
    });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.condition).toBe('open_box');
      expect(result.data.min_price).toBe(1000);
      expect(result.data.max_price).toBe(9000);
      expect(result.data.offset).toBe(50);
      expect(result.data.has_images).toBe(true);
    }
  });

  it('coerces explicit false-like has_images values to false', () => {
    const result = storefrontProductsQuerySchema.safeParse({
      merchant_id: VALID_MERCHANT_ID,
      has_images: 'false',
    });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.has_images).toBe(false);
    }
  });

  it('rejects invalid merchant ids and invalid condition values', () => {
    expect(
      storefrontProductsQuerySchema.safeParse({
        merchant_id: 'not-a-uuid',
      }).success
    ).toBe(false);
    expect(
      storefrontProductsQuerySchema.safeParse({
        merchant_id: VALID_MERCHANT_ID,
        condition: 'broken',
      }).success
    ).toBe(false);
  });

  it('rejects unbounded storefront search offsets', () => {
    expect(
      storefrontProductsQuerySchema.safeParse({
        merchant_id: VALID_MERCHANT_ID,
        offset: '100001',
      }).success
    ).toBe(false);
  });
});
