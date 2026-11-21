import { describe, expect, it } from 'vitest';
import { isChatwootCheckoutPaymentWindowOpen } from './chatwoot-checkout-payment-window';

const MINUTE = 60 * 1000;

describe('isChatwootCheckoutPaymentWindowOpen', () => {
  it('stays open through the 90 minutes a dedicated account is bound to its order', () => {
    const issuedAt = 1_700_000_000_000;

    expect(isChatwootCheckoutPaymentWindowOpen(issuedAt, issuedAt)).toBe(true);
    expect(
      isChatwootCheckoutPaymentWindowOpen(issuedAt, issuedAt + 89 * MINUTE)
    ).toBe(true);
    expect(
      isChatwootCheckoutPaymentWindowOpen(issuedAt, issuedAt + 90 * MINUTE)
    ).toBe(true);
  });

  it('closes once the 90 minutes have passed', () => {
    const issuedAt = 1_700_000_000_000;

    expect(
      isChatwootCheckoutPaymentWindowOpen(issuedAt, issuedAt + 90 * MINUTE + 1)
    ).toBe(false);
  });

  it('uses the current time by default', () => {
    expect(isChatwootCheckoutPaymentWindowOpen(Date.now())).toBe(true);
    expect(isChatwootCheckoutPaymentWindowOpen(Date.now() - 91 * MINUTE)).toBe(
      false
    );
  });
});
