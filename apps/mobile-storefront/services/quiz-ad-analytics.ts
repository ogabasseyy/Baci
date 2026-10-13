import { Platform } from 'react-native';
import { trackEvent } from '@/services/analytics-core';

type QuizAdEventName = 'quiz_ad_failed' | 'quiz_ad_impression' | 'quiz_ad_paid';

interface QuizAdEventProperties {
  currency?: string;
  errorCode?: string;
  precision?: string;
  valueMicros?: number;
}

export function trackQuizAdEvent(
  eventName: QuizAdEventName,
  properties: QuizAdEventProperties = {}
): void {
  trackEvent(eventName, {
    ...properties,
    format: 'banner',
    placement: 'quiz_question_footer',
    platform: Platform.OS === 'android' ? 'android' : 'ios',
  });
}
