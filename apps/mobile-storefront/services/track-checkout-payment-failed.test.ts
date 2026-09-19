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

  it('emits the funnel payment_failed event', () => {
    trackCheckoutPaymentFailed('gateway_timeout', 'o3', 'paystack');

    expect(trackEvent).toHaveBeenCalledWith(
      'payment_failed',
      expect.objectContaining({ reason: 'gateway_timeout' })
    );
  });
});
