import { describe, expect, it } from 'vitest';
import type { GoogleMerchantListing } from '@/app/api/feed/google-merchant/feed-builder';
import { getSellableIdentity } from './sellable-identity';

function makeRow(
  overrides: {
    productCondition?: GoogleMerchantListing['product']['condition'];
    variant?: GoogleMerchantListing['variant'];
    offer?: GoogleMerchantListing['offer'];
  } = {}
): GoogleMerchantListing {
  return {
    id: 'prod-1',
    imageUrl: 'https://cdn.example.test/phone.jpg',
    url: 'https://store.example.test/products/phone',
    title: 'Phone',
    price: 1000,
    stock: 1,
    product: {
      id: 'prod-1',
      name: 'Phone',
      slug: 'phone',
      description: 'Test product',
      price: 1000,
      stock: 1,
      manage_stock: true,
      condition: overrides.productCondition,
    },
    variant: overrides.variant,
    offer: overrides.offer,
  };
}

describe('getSellableIdentity', () => {
  it('resolves condition with variant -> offer -> product precedence', () => {
    expect(
      getSellableIdentity(
        makeRow({
          productCondition: 'new',
          offer: { id: 'offer-1', condition: 'open_box', price: 800 },
          variant: { id: 'var-1', condition: 'used' },
        })
      )
    ).toEqual({
      productId: 'prod-1',
      variantId: 'var-1',
      offerId: 'offer-1',
      condition: 'used',
    });

    expect(
      getSellableIdentity(
        makeRow({
          productCondition: 'new',
          offer: { id: 'offer-1', condition: 'open_box', price: 800 },
        })
      )
    ).toEqual({
      productId: 'prod-1',
      variantId: undefined,
      offerId: 'offer-1',
      condition: 'open_box',
    });

    expect(getSellableIdentity(makeRow({ productCondition: 'new' }))).toEqual({
      productId: 'prod-1',
      variantId: undefined,
      offerId: undefined,
      condition: 'new',
    });
  });

  it('returns null when condition is missing or unrecognized', () => {
    expect(getSellableIdentity(makeRow())).toBeNull();
    const row = makeRow();
    // @ts-expect-error Exercise unexpected source data at the runtime boundary.
    row.product.condition = 'refurbished_unknown';
    expect(getSellableIdentity(row)).toBeNull();
  });
});
