import { describe, expect, it, jest } from '@jest/globals';
import { trackEvent } from '@/services/analytics-core';
import { trackInterstitialPaidEvent } from './interstitial-paid-event';

jest.mock('@/services/analytics-core', () => ({
  trackEvent: jest.fn(),
}));

const mockTrackEvent = jest.mocked(trackEvent);

describe('trackInterstitialPaidEvent', () => {
  it('freezes the placement, currency, precision, and micros mapping', () => {
    // Arrange & Act
    trackInterstitialPaidEvent('POST_ORDER_INTERSTITIAL', {
      currency: 'USD',
      precision: 1,
      value: 0.000_02,
    });

    // Assert
    expect(mockTrackEvent).toHaveBeenCalledWith('mobile_ad_paid', {
      currency: 'USD',
      format: 'interstitial',
      placement: 'POST_ORDER_INTERSTITIAL',
      precision: '1',
      valueMicros: 0.000_02,
    });
  });

  it('attributes quiz-start revenue to its own placement', () => {
    // Arrange & Act
    trackInterstitialPaidEvent('QUIZ_START_INTERSTITIAL', {
      currency: 'NGN',
      precision: 0,
      value: 0,
    });

    // Assert
    expect(mockTrackEvent).toHaveBeenCalledWith(
      'mobile_ad_paid',
      expect.objectContaining({
        format: 'interstitial',
        placement: 'QUIZ_START_INTERSTITIAL',
      })
    );
  });
});
