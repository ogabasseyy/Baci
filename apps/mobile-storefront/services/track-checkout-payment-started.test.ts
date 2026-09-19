import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { trackEvent } from './analytics-core';
import { trackCheckoutPaymentStarted } from './track-checkout-payment-started';

jest.mock('./analytics-core', () => ({
  trackEvent: jest.fn(),
}));

describe('trackCheckoutPaymentStarted', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('emits the funnel payment_started event', async () => {
    await trackCheckoutPaymentStarted({
      orderId: 'o2',
      paymentMethod: 'paystack',
    });

    expect(trackEvent).toHaveBeenCalledWith(
      'payment_started',
      expect.objectContaining({ order_id: 'o2' })
    );
  });

  it('waits behind a pending order-created emission for the same order', async () => {
    const { serializeAfterOrderCreated } = await import(
      './serialize-after-order-created'
    );
    let releaseCreated!: () => void;
    const created = serializeAfterOrderCreated(
      'o9',
      () =>
        new Promise<void>((resolve) => {
          releaseCreated = resolve;
        })
    );
    const started = trackCheckoutPaymentStarted({
      orderId: 'o9',
      paymentMethod: 'paystack',
    });

    // Started is held until the creation write lands.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(trackEvent).not.toHaveBeenCalled();

    releaseCreated();
    await created;
    await started;
    expect(trackEvent).toHaveBeenCalledWith(
      'payment_started',
      expect.objectContaining({ order_id: 'o9' })
    );
  });
});
