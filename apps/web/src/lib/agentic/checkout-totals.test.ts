import { describe, expect, it } from 'vitest';
import { getCheckoutGrandTotal } from './checkout-totals';

describe('getCheckoutGrandTotal', () => {
  it('returns numeric and decimal-string totals', () => {
    expect(
      getCheckoutGrandTotal([
        { type: 'subtotal', display_text: 'Subtotal', amount: 1000 },
        { type: 'total', display_text: 'Total', amount: 2500.5 },
      ])
    ).toBe(2500.5);
    expect(
      getCheckoutGrandTotal([
        { type: 'total', display_text: 'Total', amount: '2500.50' },
      ])
    ).toBe(2500.5);
  });

  it('rejects missing, negative, non-finite, and malformed totals', () => {
    const invalidTotals = [
      [],
      [{ type: 'total', display_text: 'Total', amount: -1 }],
      [{ type: 'total', display_text: 'Total', amount: Number.NaN }],
      [{ type: 'total', display_text: 'Total', amount: '1e3' }],
      [{ type: 'total', display_text: 'Total', amount: 'Infinity' }],
    ] as const;

    for (const totals of invalidTotals) {
      expect(() => getCheckoutGrandTotal([...totals])).toThrow(
        'Missing or invalid total amount'
      );
    }
  });
});
