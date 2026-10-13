import { describe, expect, it } from 'vitest';
import { applyFallbackTransactionDiscount } from './transaction-review-discount-fallback';

describe('applyFallbackTransactionDiscount', () => {
  it('preserves negative adjustments while discounting merchandise', () => {
    const items = [
      { price: -100, quantity: 1 },
      { price: 100, quantity: 1 },
    ];
    const unitPrices = [-100, 100];
    const lineTotals = [
      { merchandiseTotal: 0, quantity: 1, total: 0 },
      { merchandiseTotal: 100, quantity: 1, total: 100 },
    ];

    const prices = applyFallbackTransactionDiscount(
      items,
      unitPrices,
      lineTotals,
      50,
      undefined,
      new Set(),
      0
    );

    expect(prices).toEqual([-100, 50]);
  });
});
