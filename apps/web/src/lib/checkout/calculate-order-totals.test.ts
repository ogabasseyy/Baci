import { describe, expect, it } from 'vitest';
import { calculateOrderTotals } from './calculate-order-totals';

describe('calculateOrderTotals', () => {
  it.each([
    {
      name: 'uses the Edge default VAT rate',
      input: { subtotal: 1000, shippingFee: 80 },
      expected: { taxAmount: 75, total: 1155 },
    },
    {
      name: 'rounds fractional VAT and the resulting total to two decimals',
      input: { subtotal: 199.99, shippingFee: 50.005, taxRate: 0.075 },
      expected: { taxAmount: 15, total: 264.99 },
    },
    {
      name: 'preserves a tax-exempt checkout',
      input: { subtotal: 199.99, shippingFee: 50.005, taxRate: 0 },
      expected: { taxAmount: 0, total: 250 },
    },
  ])('$name', ({ input, expected }) => {
    expect(calculateOrderTotals(input)).toEqual(expected);
  });
});
