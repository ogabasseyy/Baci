import { describe, expect, it } from 'vitest';
import type { ProductConditionOffer } from '../../types';
import { resolveProductDetailsRouteSelection } from './product-details-route-selection';

const offers: ProductConditionOffer[] = [
  {
    id: 'offer-used-1',
    condition: 'used',
    price: '₦4,000',
    rawPrice: 4000,
    stock_quantity: 3,
  },
];

function resolve(
  query: string,
  overrides: {
    offers?: ProductConditionOffer[] | undefined;
    usesVariantRouteSelection?: boolean;
  } = {}
) {
  return resolveProductDetailsRouteSelection({
    offers: overrides.offers === undefined ? offers : overrides.offers,
    resolutionProduct: { variants: [] } as never,
    searchParams: new URLSearchParams(query),
    usesVariantRouteSelection: overrides.usesVariantRouteSelection ?? false,
  });
}

describe('resolveProductDetailsRouteSelection', () => {
  it('derives the route condition from a live offer id', () => {
    const selection = resolve('offer_id=offer-used-1');

    expect(selection.routeCondition).toBe('used');
    expect(selection.routeOfferId).toBe('offer-used-1');
  });

  it('keeps an explicit condition authoritative over the offer id', () => {
    const selection = resolve('condition=open_box&offer_id=offer-used-1');

    expect(selection.routeCondition).toBe('open_box');
    expect(selection.routeOfferId).toBe('offer-used-1');
  });

  it('ignores an offer id that names no offer on this product', () => {
    const selection = resolve('offer_id=offer-gone');

    expect(selection.routeCondition).toBe('');
    expect(selection.routeOfferId).toBeNull();
  });

  it('returns empty route inputs when the url carries no selection', () => {
    const selection = resolve('');

    expect(selection.routeCondition).toBe('');
    expect(selection.routeOfferId).toBeNull();
    expect(selection.routeSelectionAttributes).toEqual({});
    expect(selection.routeVariantId).toBeUndefined();
  });
});
