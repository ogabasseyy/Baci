import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { trackEvent } from './analytics-core';
import { trackCheckoutPaymentEvent } from './track-checkout-payment-event';

jest.mock('./analytics-core', () => ({
  trackEvent: jest.fn(),
}));

describe('trackCheckoutPaymentEvent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('builds the shared payment event envelope', () => {
    trackCheckoutPaymentEvent(
      'payment_started',
      { orderId: 'o2', paymentMethod: 'paystack', value: 100 },
      undefined
    );

    expect(trackEvent).toHaveBeenCalledWith(
      'payment_started',
      expect.objectContaining({
        order_id: 'o2',
        payment_intent: 'pay_now',
        total: 100,
      })
    );
  });

  it('stamps the checkout currency instead of the default', () => {
    trackCheckoutPaymentEvent(
      'payment_completed',
      {
        orderId: 'o3',
        paymentMethod: 'korapay',
        value: 200,
        currency: 'USD',
      },
      'paid'
    );

    expect(trackEvent).toHaveBeenCalledWith(
      'payment_completed',
      expect.objectContaining({ currency: 'USD' })
    );
  });
});
