import { describe, expect, it } from 'vitest';
import { resolveCurrentOffer } from './offer-resolution';
import type { NormalizedProductDetails } from './product-normalization';

function productWith(overrides: Record<string, unknown>): NormalizedProductDetails {
  return {
    id: 'phone',
    rawPrice: 500,
    price: '500',
    condition: 'new',
    manage_stock: false,
    ...overrides,
  } as unknown as NormalizedProductDetails;
}

describe('resolveCurrentOffer', () => {
  it('resolves merchant-spelled offers through canonical conditions', () => {
    const offer = resolveCurrentOffer(
      productWith({
        offers: [{ condition: 'refurbished', rawPrice: 400, stock_quantity: 1 }],
      }),
      'open_box',
      {}
    );
    expect(offer.rawPrice).toBe(400);
  });

  it('prefers the selected variant price over any offer price', () => {
    const offer = resolveCurrentOffer(
      productWith({
        offers: [{ condition: 'used', rawPrice: 450, stock_quantity: 1 }],
      }),
      'used',
      {},
      {
        attributes: {},
        price: 700,
        variant: { id: 'v-256', stock_quantity: 1 },
      }
    );
    expect(offer.rawPrice).toBe(700);
  });
});
