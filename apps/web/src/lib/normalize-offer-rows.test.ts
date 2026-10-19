import { describe, expect, it } from 'vitest';
import { normalizeOfferRows } from './normalize-offer-rows';

describe('normalizeOfferRows', () => {
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
