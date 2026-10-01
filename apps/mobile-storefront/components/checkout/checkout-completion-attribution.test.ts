import { describe, expect, it } from '@jest/globals';
import { buildCheckoutCompletionAttribution } from './checkout-completion-attribution';

describe('buildCheckoutCompletionAttribution', () => {
  it('snapshots guest identity and the canonical breakdown', () => {
    expect(
      buildCheckoutCompletionAttribution({
        customerEmail: 'guest@example.com',
        customerPhone: '+2348123456789',
        userId: undefined,
        items: [],
        snapshot: { deliveryFee: 1500, subtotal: 45000, taxAmount: 3375 },
      })
    ).toEqual({
      customerEmail: 'guest@example.com',
      customerPhone: '+2348123456789',
      items: [],
      shipping: 1500,
      subtotal: 45000,
      tax: 3375,
      userId: undefined,
    });
  });
});
