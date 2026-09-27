import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { trackEvent } from './analytics-core';
import { trackCheckoutPaymentCompleted } from './track-checkout-payment-completed';

jest.mock('./analytics-core', () => ({
  trackEvent: jest.fn(),
}));

describe('trackCheckoutPaymentCompleted', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('emits the funnel payment_completed event', () => {
    trackCheckoutPaymentCompleted({ orderId: 'o2', paymentMethod: 'paystack' });

    expect(trackEvent).toHaveBeenCalledWith(
      'payment_completed',
      expect.objectContaining({ payment_status: 'paid' })
    );
  });
});
