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

  it('keeps the parent price when the legacy-spelled parent matches the selection', () => {
    const offer = resolveCurrentOffer(
      productWith({
        condition: 'uk_used',
        offers: [{ condition: 'used', rawPrice: 450, stock_quantity: 1 }],
      }),
      'used',
      {}
    );
    expect(offer.rawPrice).toBe(500);
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
  it('inherits managed parent stock for a selected nullable nonserialized variant', () => {
    const offer = resolveCurrentOffer(
      productWith({ manage_stock: true, stock_quantity: 4 }), 'new', {},
      { attributes: {}, price: 700, variant: { id: 'v-null', stock_quantity: null } }
    );
    expect(offer.stock).toBe(4);
    expect(offer.rawPrice).toBe(700);
  });

  it('preserves a zero override in the attribute-selection adapter', () => {
    const offer = resolveCurrentOffer(productWith({ variants: [
      { id: 'zero', attributes: { color: 'black' }, price_override: 0, stock_quantity: 1 }
    ] }), 'new', { color: 'black' });
    expect(offer.rawPrice).toBe(0);
  });

  it('prices a paired attribute-selected variant from its parent, not the offer', () => {
    const offer = resolveCurrentOffer(productWith({
      offers: [{ condition: 'used', rawPrice: 400, stock_quantity: 2 }],
      variants: [{ id: 'v', attributes: { color: 'black' }, price_modifier: 50, stock_quantity: 1 }],
    }), 'used', { color: 'black' });
    expect(offer.rawPrice).toBe(550);
  });

  it('keeps a known depleted null-managed base quantity at zero', () => {
    expect(resolveCurrentOffer(productWith({ manage_stock: null, stock_quantity: 0 }), 'new', {}).stock).toBe(0);
  });

});
