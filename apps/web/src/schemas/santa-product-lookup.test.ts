import { describe, expect, it } from 'vitest';
import {
  santaProductLookupResponseSchema,
  santaProductLookupSchema,
} from './santa-product-lookup';

describe('santaProductLookupSchema', () => {
  it('trims the requested product name', () => {
    expect(santaProductLookupSchema.parse({ name: '  Phone  ' })).toEqual({
      name: 'Phone',
    });
  });

  it('rejects blank product names', () => {
    expect(santaProductLookupSchema.safeParse({ name: '   ' }).success).toBe(
      false
    );
  });

  it('rejects overlong product names', () => {
    expect(
      santaProductLookupSchema.safeParse({ name: 'p'.repeat(201) }).success
    ).toBe(false);
  });
});

describe('santaProductLookupResponseSchema', () => {
  const product = {
    id: 'prod-1',
    name: 'Phone',
    slug: 'phone',
    description: 'A phone',
    price: 100,
    max_discount_percentage: 2,
    image: 'https://img/phone.jpg',
    imageLarge: 'https://img/phone-large.jpg',
    imageHint: 'phone',
    status: 'active',
    merchant_id: 'merchant-1',
    stock: 4,
    manage_stock: true,
    brand: 'Acme',
    sku: 'SKU-1',
    gtin: '',
    mpn: '',
  } as const;

  it('accepts a resolved product payload', () => {
    expect(
      santaProductLookupResponseSchema.parse({ product }).product
    ).toMatchObject({ id: 'prod-1', name: 'Phone' });
  });

  it('accepts an unresolved lookup', () => {
    expect(
      santaProductLookupResponseSchema.parse({ product: null }).product
    ).toBeNull();
  });

  it('rejects payloads with invalid product data', () => {
    expect(
      santaProductLookupResponseSchema.safeParse({
        product: { ...product, price: '100' },
      }).success
    ).toBe(false);
  });
});
