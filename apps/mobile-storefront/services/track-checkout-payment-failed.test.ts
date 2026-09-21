import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { trackEvent } from './analytics-core';
import { serializeAfterOrderCreated } from './serialize-after-order-created';
import { trackCheckoutPaymentFailed } from './track-checkout-payment-failed';
import { trackCheckoutPaymentStarted } from './track-checkout-payment-started';

jest.mock('./analytics-core', () => ({
  trackEvent: jest.fn(),
}));

describe('trackCheckoutPaymentFailed', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('emits the funnel payment_failed event', async () => {
    await trackCheckoutPaymentFailed('gateway_timeout', 'o3', 'paystack');

    expect(trackEvent).toHaveBeenCalledWith(
      'payment_failed',
      expect.objectContaining({ reason: 'gateway_timeout' })
    );
  });

  it('stamps the failure with the attempt reference when provided', async () => {
    await trackCheckoutPaymentFailed(
      'gateway_timeout',
      'o3',
      'paystack',
      'ref-7'
    );

    expect(trackEvent).toHaveBeenCalledWith(
      'payment_failed',
      expect.objectContaining({
        reason: 'gateway_timeout',
        reference: 'ref-7',
      })
    );
  });

  it('emits pre-order failures without waiting for a claim', async () => {
    await trackCheckoutPaymentFailed('checkout_error', undefined, 'paystack');

    expect(trackEvent).toHaveBeenCalledWith(
      'payment_failed',
      expect.objectContaining({ reason: 'checkout_error' })
    );
  });

  it('serializes an opened-then-error sequence behind a pending order claim', async () => {
    let releaseClaim!: () => void;
    const claimGate = new Promise<void>((resolve) => {
      releaseClaim = resolve;
    });
    // A still-pending order-created write holds this order's tail.
    const claim = serializeAfterOrderCreated('o-race', () => claimGate);
    // The provider opened, then its SDK errored, while the claim was
    // unresolved: the start queues behind the claim, and the failure must
    // queue behind the start — never jump ahead of either.
    const started = trackCheckoutPaymentStarted({
      orderId: 'o-race',
      paymentMethod: 'credit_direct',
    });
    const failed = trackCheckoutPaymentFailed(
      'bnpl_provider_error',
      'o-race',
      'credit_direct'
    );
    await Promise.resolve();
    expect(trackEvent).not.toHaveBeenCalled();

    releaseClaim();
    await claim;
    await started;
    await failed;

    const events = jest
      .mocked(trackEvent)
      .mock.calls.map(([event]) => event);
    expect(events).toEqual(['payment_started', 'payment_failed']);
  });
});
