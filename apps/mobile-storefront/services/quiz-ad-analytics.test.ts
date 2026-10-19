import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Platform } from 'react-native';

jest.mock('@/services/analytics-core', () => ({ trackEvent: jest.fn() }));

import { trackEvent } from '@/services/analytics-core';
import { trackQuizAdEvent } from './quiz-ad-analytics';

const mockTrackEvent = jest.mocked(trackEvent);

describe('trackQuizAdEvent', () => {
  beforeEach(() => {
    mockTrackEvent.mockReset();
  });

  it('records a banner impression without player or question identifiers', () => {
    trackQuizAdEvent('quiz_ad_impression');

    expect(mockTrackEvent).toHaveBeenCalledWith('quiz_ad_impression', {
      format: 'banner',
      placement: 'quiz_question_footer',
      platform: Platform.OS === 'android' ? 'android' : 'ios',
    });
  });

  it('records only bounded failure metadata', () => {
    trackQuizAdEvent('quiz_ad_failed', { errorCode: 'google/no-fill' });

    expect(mockTrackEvent).toHaveBeenCalledWith('quiz_ad_failed', {
      errorCode: 'google/no-fill',
      format: 'banner',
      placement: 'quiz_question_footer',
      platform: Platform.OS === 'android' ? 'android' : 'ios',
    });
  });

  it('records impression-level revenue in micros', () => {
    trackQuizAdEvent('quiz_ad_paid', {
      currency: 'NGN',
      precision: 'estimated',
      valueMicros: 1500,
    });

    expect(mockTrackEvent).toHaveBeenCalledWith('quiz_ad_paid', {
      currency: 'NGN',
      format: 'banner',
      placement: 'quiz_question_footer',
      platform: Platform.OS === 'android' ? 'android' : 'ios',
      precision: 'estimated',
      valueMicros: 1500,
    });
  });
});
