import { describe, expect, it } from 'vitest';
import {
  hasStockedOffer,
  isSameConditionOffer,
  normalizeOfferRows,
} from './related-blog-product-offer-rows';

describe('related blog product offer rows', () => {
  it('matches offer rows that carry the parent condition', () => {
    expect(isSameConditionOffer('New', 'new')).toBe(true);
    expect(isSameConditionOffer('uk_used', 'Used')).toBe(true);
  });

  it('keeps offers with a different condition than the parent', () => {
    expect(isSameConditionOffer('used', 'new')).toBe(false);
    expect(isSameConditionOffer('used', null)).toBe(false);
  });

  it('keeps rows with an unknown condition fail-open', () => {
    expect(isSameConditionOffer('weird-grade', 'new')).toBe(false);
    expect(isSameConditionOffer(null, 'new')).toBe(false);
    expect(isSameConditionOffer(undefined, undefined)).toBe(false);
  });

  it('ignores same-condition rows when detecting stocked offers', () => {
    expect(
      hasStockedOffer(
        [
          { condition: 'New', stock_quantity: 2 },
          { condition: 'used', stock_quantity: 0 },
        ],
        'new'
      )
    ).toBe(false);
    expect(
      hasStockedOffer([{ condition: 'Used', stock_quantity: 2 }], 'new')
    ).toBe(true);
  });

  it('filters same-condition rows while preserving kept conditions', () => {
    expect(
      normalizeOfferRows(
        [
          { condition: 'New', price: 150000, stock_quantity: 2 },
          { condition: 'used', price: 120000, stock_quantity: 1 },
        ],
        'new'
      )
    ).toEqual([
      {
        condition: 'used',
        price: 120000,
        status: 'active',
        stock_quantity: 1,
      },
    ]);
  });
});
