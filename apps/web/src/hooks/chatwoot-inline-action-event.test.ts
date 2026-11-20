import { describe, expect, it } from 'vitest';
import { isChatwootInlineActionEvent } from './chatwoot-inline-action-event';

describe('isChatwootInlineActionEvent', () => {
  it('accepts every inline action event', () => {
    for (const event of [
      'baci-cart-request',
      'baci-cart-add',
      'baci-cart-quantity',
      'baci-product-request',
      'baci-checkout-review-request',
      'baci-delivery-options-request',
      'baci-checkout-place-request',
      'baci-checkout-payment-status-request',
    ]) {
      expect(isChatwootInlineActionEvent(event)).toBe(true);
    }
  });

  it('rejects unknown events', () => {
    expect(isChatwootInlineActionEvent('baci-cart-delete')).toBe(false);
    expect(isChatwootInlineActionEvent('')).toBe(false);
  });
});
