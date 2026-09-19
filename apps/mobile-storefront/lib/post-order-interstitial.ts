import { Platform } from 'react-native';
import type { PaidEvent } from 'react-native-google-mobile-ads';
import { isQuizMobileAdsAvailable } from '@/components/quiz/is-quiz-mobile-ads-available';
import { getMobileAdUnitId } from '@/config/mobile-ad-placements';
import { trackEvent } from '@/services/analytics-core';
import { initializeQuizMobileAds } from '@/services/initialize-quiz-mobile-ads';
import { trackInterstitialPaidEvent } from './interstitial-paid-event';

/**
 * Post-order interstitial, capped to one presentation per app session so a
 * purchase celebration never turns into an ad loop. No-ops while ads are
 * disabled, on web, or when the native ads module is unavailable.
 */
let didShowThisSession = false;
// A load in progress already holds the session cap: a second invocation
// while the first ad is still loading must not create a second
// interstitial, or a rapid remount could present two ads.
let loadInFlight = false;

export function resetPostOrderInterstitialForTests(): void {
  didShowThisSession = false;
  loadInFlight = false;
}

export function wasPostOrderInterstitialShown(): boolean {
  return didShowThisSession;
}

export interface PostOrderInterstitialOptions {
  /**
   * Polled before presenting a loaded interstitial. When it returns true the
   * load is abandoned as `skipped` instead of showing an ad over an
   * unrelated screen after the shopper leaves order success.
   */
  isCancelled?: () => boolean;
  /**
   * Invoked when a presented interstitial closes so hosts can remount
   * banner slots withheld while the full-screen ad owned the screen.
   */
  onClosed?: () => void;
}

// biome-ignore lint/suspicious/useAwait: async wraps the early 'skipped' returns in the declared Promise.
export async function maybeShowPostOrderInterstitial(
  options: PostOrderInterstitialOptions = {}
): Promise<'shown' | 'skipped'> {
  if (didShowThisSession) {
    return 'skipped';
  }
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    return 'skipped';
  }

  let config: ReturnType<typeof getMobileAdUnitId>;
  try {
    config = getMobileAdUnitId('POST_ORDER_INTERSTITIAL');
  } catch {
    return 'skipped';
  }
  if (!config.enabled || config.format !== 'interstitial') {
    return 'skipped';
  }

  // Consent gate: never request the interstitial before UMP consent is
  // gathered and the protective under-age configuration is applied.
  try {
    if (!isQuizMobileAdsAvailable()) {
      return 'skipped';
    }
    const { canRequestAds } = await initializeQuizMobileAds();
    if (!canRequestAds) {
      return 'skipped';
    }
  } catch {
    return 'skipped';
  }

  let mobileAds: typeof import('react-native-google-mobile-ads') | null = null;
  try {
    mobileAds =
      require('react-native-google-mobile-ads') as typeof import('react-native-google-mobile-ads');
  } catch {
    return 'skipped';
  }
  if (!mobileAds) {
    return 'skipped';
  }

  if (loadInFlight) {
    return 'skipped';
  }

  return new Promise<'shown' | 'skipped'>((resolve) => {
    let settled = false;
    const finish = (outcome: 'shown' | 'skipped') => {
      if (settled) return;
      settled = true;
      loadInFlight = false;
      if (outcome === 'shown') {
        didShowThisSession = true;
        trackEvent('mobile_ad_impression', {
          format: 'interstitial',
          placement: 'POST_ORDER_INTERSTITIAL',
        });
      }
      resolve(outcome);
    };

    try {
      loadInFlight = true;
      const interstitial = mobileAds.InterstitialAd.createForAdRequest(
        config.unitId
      );
      // The deadline below guards the load phase only: once LOADED fires the
      // attempt is owned through presentation, so a load finishing just
      // before the deadline must not settle as skipped while show() can
      // still complete (which would release the session cap for a later
      // visit without recording it).
      let loadTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
        loadTimer = null;
        for (const unsubscribe of cleanups) unsubscribe();
        finish('skipped');
      }, 30_000);
      const cleanups = [
        interstitial.addAdEventListener(mobileAds.AdEventType.LOADED, () => {
          if (loadTimer !== null) {
            clearTimeout(loadTimer);
            loadTimer = null;
          }
          // The shopper may have left order success while the ad was
          // loading; presenting now would surface it on an unrelated screen.
          if (options.isCancelled?.()) {
            finish('skipped');
            return;
          }
          try {
            void interstitial.show().then(
              () => finish('shown'),
              () => finish('skipped')
            );
          } catch {
            finish('skipped');
          }
        }),
        interstitial.addAdEventListener(mobileAds.AdEventType.ERROR, () =>
          finish('skipped')
        ),
        interstitial.addAdEventListener(mobileAds.AdEventType.PAID, (payload) =>
          trackInterstitialPaidEvent(
            'POST_ORDER_INTERSTITIAL',
            // The SDK types the PAID payload as undefined, but the native
            // bridge delivers { currency, precision, value } for
            // full-screen ads (verified in the installed v16 sources).
            payload as unknown as PaidEvent
          )
        ),
        interstitial.addAdEventListener(mobileAds.AdEventType.CLOSED, () => {
          options.onClosed?.();
          finish(didShowThisSession ? 'shown' : 'skipped');
        }),
      ];
      interstitial.load();
    } catch {
      finish('skipped');
    }
  });
}
