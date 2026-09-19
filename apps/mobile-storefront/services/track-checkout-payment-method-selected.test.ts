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

  it('emits the funnel method event', () => {
    trackCheckoutPaymentMethodSelected('invoice');

    expect(trackEvent).toHaveBeenCalledWith(
      'checkout_payment_method_selected',
      expect.objectContaining({ payment_method: 'invoice' })
    );
  });
});
