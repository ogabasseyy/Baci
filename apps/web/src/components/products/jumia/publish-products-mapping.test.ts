import { describe, expect, it } from 'vitest';
import { isJumiaProductFullyMapped } from './publish-products-mapping';

const product = {
  id: 'product-1',
  name: 'Phone',
  price: 100,
  sku: 'PHONE',
  variants: [
    { sku: 'PHONE-BLACK', price_override: 100 },
    { sku: 'PHONE-WHITE', price_override: 100 },
  ],
};

describe('isJumiaProductFullyMapped', () => {
  it('does not block a product when only one variant is mapped', () => {
    expect(
      isJumiaProductFullyMapped(product, [
        { sellerSku: 'PHONE-BLACK', syncStatus: 'synced' },
        { sellerSku: 'PHONE-WHITE', syncStatus: 'error' },
      ])
    ).toBe(false);
  });

  it('blocks a product when every sellable variant is mapped', () => {
    expect(
      isJumiaProductFullyMapped(product, [
        { sellerSku: 'PHONE-BLACK', syncStatus: 'synced' },
        { sellerSku: 'PHONE-WHITE', syncStatus: 'pending' },
      ])
    ).toBe(true);
  });

  it('uses the product SKU when there are no sellable variants', () => {
    expect(
      isJumiaProductFullyMapped(
        { id: 'product-2', name: 'Case', price: 10, sku: 'CASE' },
        [{ sellerSku: 'CASE', syncStatus: 'synced' }]
      )
    ).toBe(true);
  });

  it('keeps legacy mapped products blocked when their local SKU is absent', () => {
    expect(
      isJumiaProductFullyMapped(
        { id: 'product-3', name: 'Legacy case', price: 10 },
        [{ sellerSku: 'LEGACY-CASE', syncStatus: 'synced' }]
      )
    ).toBe(true);
  });

  it('keeps a simple mapped product blocked after its local SKU changes', () => {
    expect(
      isJumiaProductFullyMapped(
        { id: 'product-4', name: 'Case', price: 10, sku: 'CASE-NEW' },
        [{ sellerSku: 'CASE-OLD', syncStatus: 'synced' }]
      )
    ).toBe(true);
  });

  it('keeps a mapped variant blocked after its local SKU changes', () => {
    expect(
      isJumiaProductFullyMapped(
        {
          ...product,
          variants: [
            { id: 'variant-black', sku: 'PHONE-BLACK-NEW' },
            { id: 'variant-white', sku: 'PHONE-WHITE-NEW' },
          ],
        },
        [
          {
            variantId: 'variant-black',
            sellerSku: 'PHONE-BLACK-OLD',
            syncStatus: 'synced',
          },
          {
            variantId: 'variant-white',
            sellerSku: 'PHONE-WHITE-OLD',
            syncStatus: 'pending',
          },
        ]
      )
    ).toBe(true);
  });
});
