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

  it('emits the funnel payment_started event', () => {
    trackCheckoutPaymentStarted({ orderId: 'o2', paymentMethod: 'paystack' });

    expect(trackEvent).toHaveBeenCalledWith(
      'payment_started',
      expect.objectContaining({ order_id: 'o2' })
    );
  });
});
