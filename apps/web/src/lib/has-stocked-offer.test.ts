import { describe, expect, it } from 'vitest';
import { hasStockedOffer } from './has-stocked-offer';

describe('hasStockedOffer', () => {
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
});
