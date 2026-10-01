import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { trackEvent } from './analytics-core';
import { trackCheckoutPaymentFailed } from './track-checkout-payment-failed';

jest.mock('./analytics-core', () => ({
  trackEvent: jest.fn(),
}));

describe('trackCheckoutPaymentFailed', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('emits the funnel payment_failed event', async () => {
    await trackCheckoutPaymentFailed('declined', 'o1', 'paystack', 'ref-1');

    expect(trackEvent).toHaveBeenCalledWith(
      'payment_failed',
      expect.objectContaining({ order_id: 'o1' })
    );
  });

  it('stamps the checkout currency instead of the default', async () => {
    await trackCheckoutPaymentFailed(
      'declined',
      'o2',
      'korapay',
      'ref-2',
      'USD'
    );

    expect(trackEvent).toHaveBeenCalledWith(
      'payment_failed',
      expect.objectContaining({ currency: 'USD' })
    );
  });
});
