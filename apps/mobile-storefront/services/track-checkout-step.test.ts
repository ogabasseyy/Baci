import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { trackEvent } from './analytics-core';
import { trackCheckoutStep } from './track-checkout-step';

jest.mock('./analytics-core', () => ({
  trackEvent: jest.fn(),
}));

describe('trackCheckoutStep', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('emits the funnel step event', () => {
    trackCheckoutStep('shipping_info');

    expect(trackEvent).toHaveBeenCalledWith(
      'checkout_step_completed',
      expect.objectContaining({ channel: 'mobile_app' })
    );
  });
});
