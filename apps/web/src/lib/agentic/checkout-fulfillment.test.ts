import { describe, expect, it } from 'vitest';
import { buildCheckoutFulfillment } from './checkout-fulfillment';

describe('buildCheckoutFulfillment', () => {
  it('defaults to free store pickup', () => {
    const result = buildCheckoutFulfillment(null, 5000);
    expect(result.selectedOptionId).toBe('pickup_store_1');
    expect(result.totals).toContainEqual({
      amount: 5000,
      display_text: 'Total Due',
      type: 'total',
    });
  });

  it('adds the selected shipping cost to the total', () => {
    const result = buildCheckoutFulfillment('shipping_standard', 5000);
    expect(result.totals).toContainEqual({
      amount: 7500,
      display_text: 'Total Due',
      type: 'total',
    });
  });
});
