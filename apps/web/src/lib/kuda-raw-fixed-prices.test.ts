import { describe, expect, it } from 'vitest';
import { collectRawFixedPricesKobo } from './kuda-raw-fixed-prices';

describe('collectRawFixedPricesKobo', () => {
  it('reads fixed prices in either casing at any depth and skips the rest', () => {
    const prices = collectRawFixedPricesKobo([
      { amount: 100000, isFixedPrice: true },
      { Amount: '950000', IsAmountFixed: true },
      { Amount: '1,250,000', IsAmountFixed: true },
      {
        amount: 0,
        isAmountFixed: false,
        billItems: [{ amount: 250000, isAmountFixed: true }],
      },
      { amount: 700000 },
      { amount: 'oops', isAmountFixed: true },
      { amount: 0, isAmountFixed: true },
      { amount: -5, isAmountFixed: true },
      null,
      'text',
    ]);

    expect(prices).toEqual([100000, 950000, 1250000, 250000]);
  });

  it('returns nothing when there are no items', () => {
    expect(collectRawFixedPricesKobo(undefined)).toEqual([]);
    expect(collectRawFixedPricesKobo([])).toEqual([]);
  });
});
