import type { PaidEvent } from 'react-native-google-mobile-ads';
import { trackEvent } from '@/services/analytics-core';

export type InterstitialPaidPlacement =
  | 'POST_ORDER_INTERSTITIAL'
  | 'QUIZ_START_INTERSTITIAL';

/**
 * Report impression-level revenue for a full-screen placement. Uses the same
 * currency/precision/value shape as the banner instrumentation so
 * placement-level monetization reporting stays comparable across formats.
 */
export function trackInterstitialPaidEvent(
  placement: InterstitialPaidPlacement,
  event: PaidEvent
): void {
  trackEvent('mobile_ad_paid', {
    currency: event.currency,
    format: 'interstitial',
    placement,
    precision: String(event.precision),
    valueMicros: event.value,
  });
}
