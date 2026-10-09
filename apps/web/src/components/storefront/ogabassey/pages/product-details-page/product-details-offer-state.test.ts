import { describe, expect, it } from 'vitest';
import { resolveProductDetailsOfferState } from './product-details-offer-state';
import type { NormalizedProductDetails } from './product-normalization';

function productWith(
  overrides: Record<string, unknown>
): NormalizedProductDetails {
  return {
    id: 'phone',
    rawPrice: 500,
    price: '500',
    condition: 'new',
    manage_stock: true,
    stock_quantity: 2,
    ...overrides,
  } as unknown as NormalizedProductDetails;
}

describe('resolveProductDetailsOfferState', () => {
  it('resolves the parent basis for a simple product with no offer match', () => {
    const state = resolveProductDetailsOfferState({
      currentCartVariantSelection: null,
      currentVariantDisplaySelection: null,
      currentVariantSelection: null,
      productData: productWith({}),
      routeOfferId: null,
      selectedCondition: 'new',
      variantSelectionAttributes: {},
    });

    expect(state.currentOffer.rawPrice).toBe(500);
    expect(state.managesStock).toBe(true);
    expect(state.canPurchase).toBe(true);
  });

  it('prefers the exact route offer id over condition matching', () => {
    const state = resolveProductDetailsOfferState({
      currentCartVariantSelection: null,
      currentVariantDisplaySelection: null,
      currentVariantSelection: null,
      productData: productWith({
        offers: [
          {
            id: 'offer-used',
            condition: 'used',
            rawPrice: 450,
            stock_quantity: 1,
          },
          {
            id: 'offer-uk-used',
            condition: 'uk_used',
            rawPrice: 400,
            stock_quantity: 2,
          },
        ],
      }),
      routeOfferId: 'offer-uk-used',
      selectedCondition: 'used',
      variantSelectionAttributes: {},
    });

    expect(state.currentOffer.rawPrice).toBe(400);
    expect(state.canPurchase).toBe(true);
  });

  it('gates variant products on a resolved purchasable selection', () => {
    const base = {
      currentVariantDisplaySelection: null,
      productData: productWith({
        variants: [{ id: 'v1', stock_quantity: 0 }],
      }),
      routeOfferId: null,
      selectedCondition: 'new' as const,
      variantSelectionAttributes: {},
    };

    expect(
      resolveProductDetailsOfferState({
        ...base,
        currentCartVariantSelection: null,
        currentVariantSelection: null,
      }).canPurchase
    ).toBe(false);
    expect(
      resolveProductDetailsOfferState({
        ...base,
        currentCartVariantSelection: {
          attributes: {},
          price: 500,
          variant: { id: 'v1', stock_quantity: 3 },
        },
        currentVariantSelection: {
          attributes: {},
          price: 500,
          variant: { id: 'v1', stock_quantity: 3 },
        },
      }).canPurchase
    ).toBe(true);
  });
});
