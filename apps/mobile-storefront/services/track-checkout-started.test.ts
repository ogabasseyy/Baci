import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { trackEvent } from './analytics-core';
import { trackCheckoutStarted } from './track-checkout-started';

jest.mock('./analytics-core', () => ({
  trackEvent: jest.fn(),
}));

describe('trackCheckoutStarted', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('emits the funnel checkout_started event', () => {
    trackCheckoutStarted({ itemCount: 2, subtotal: 450000 });

    expect(trackEvent).toHaveBeenCalledWith(
      'checkout_started',
      expect.objectContaining({ channel: 'mobile_app' })
    );
  });
});
