import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { trackEvent } from './analytics-core';
import { trackCheckoutPaymentMethodSelected } from './track-checkout-payment-method-selected';

jest.mock('./analytics-core', () => ({
  trackEvent: jest.fn(),
}));

describe('trackCheckoutPaymentMethodSelected', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('emits the funnel payment_method_selected event', () => {
    trackCheckoutPaymentMethodSelected('paystack');

    expect(trackEvent).toHaveBeenCalledWith(
      'checkout_payment_method_selected',
      expect.objectContaining({ payment_method: 'paystack' })
    );
  });

  it('stamps the checkout currency instead of the default', () => {
    trackCheckoutPaymentMethodSelected('korapay', 'USD');

    expect(trackEvent).toHaveBeenCalledWith(
      'checkout_payment_method_selected',
      expect.objectContaining({ currency: 'USD' })
    );
  });
});
