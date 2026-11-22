import { describe, expect, it } from 'vitest';
import {
  CHATWOOT_CHECKOUT_FAILURE_CODES,
  isChatwootCheckoutEvent,
} from './chatwoot-checkout-result';

describe('chat checkout result vocabulary', () => {
  it('exposes the fixed failure code set, including unsupported carts', () => {
    expect([...CHATWOOT_CHECKOUT_FAILURE_CODES]).toEqual([
      'disabled',
      'cart_changed',
      'delivery_unavailable',
      'details_invalid',
      'order_failed',
      'payment_unavailable',
      'cart_unsupported',
    ]);
  });

  it('recognizes only the two checkout events', () => {
    expect(isChatwootCheckoutEvent('baci-checkout-place-request')).toBe(true);
    expect(
      isChatwootCheckoutEvent('baci-checkout-payment-status-request')
    ).toBe(true);
    expect(isChatwootCheckoutEvent('baci-checkout-review-request')).toBe(false);
    expect(isChatwootCheckoutEvent('')).toBe(false);
  });
});
