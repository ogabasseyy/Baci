import { describe, expect, it } from 'vitest';
import type { GoogleMerchantListing } from '@/app/api/feed/google-merchant/feed-builder';
import { getSellableIdentity } from './sellable-identity';

function makeRow(
  overrides: {
    productCondition?: string;
    variant?: { id: string; condition?: string };
    offer?: { id: string; condition?: string };
  } = {}
): GoogleMerchantListing {
  return {
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
    variant: overrides.variant as GoogleMerchantListing['variant'],
    offer: overrides.offer as GoogleMerchantListing['offer'],
  } as GoogleMerchantListing;
}

describe('getSellableIdentity', () => {
  it('resolves condition with variant -> offer -> product precedence', () => {
    expect(
      getSellableIdentity(
        makeRow({
          productCondition: 'new',
          offer: { id: 'offer-1', condition: 'open_box' },
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
          offer: { id: 'offer-1', condition: 'open_box' },
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
    expect(
      getSellableIdentity(makeRow({ productCondition: 'refurbished_unknown' }))
    ).toBeNull();
  });
});
