import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { trackEvent } from './analytics-core';
import { trackCheckoutOrderCreated } from './track-checkout-order-created';

jest.mock('./analytics-core', () => ({
  trackEvent: jest.fn(),
}));

describe('trackCheckoutOrderCreated', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('emits the funnel order_created event', () => {
    trackCheckoutOrderCreated({
      orderId: 'o1',
      orderNumber: 'N1',
      total: 100,
      itemCount: 1,
      paymentMethod: 'paystack',
    });

    expect(trackEvent).toHaveBeenCalledWith(
      'order_created',
      expect.objectContaining({ order_id: 'o1' })
    );
  });

  it('stamps the checkout currency instead of the default', () => {
    trackCheckoutOrderCreated({
      orderId: 'o2',
      orderNumber: 'N2',
      total: 200,
      itemCount: 1,
      paymentMethod: 'paystack',
      currency: 'USD',
    });

    expect(trackEvent).toHaveBeenCalledWith(
      'order_created',
      expect.objectContaining({ currency: 'USD' })
    );
  });
});
