import { Platform } from 'react-native';
import { isQuizMobileAdsAvailable } from '@/components/quiz/is-quiz-mobile-ads-available';
import { getMobileAdUnitId } from '@/config/mobile-ad-placements';
import { trackEvent } from '@/services/analytics-core';
import { initializeQuizMobileAds } from '@/services/initialize-quiz-mobile-ads';

/**
 * Pre-quiz interstitial, shown when the waiting room opens and capped to one
 * presentation per app session so lobby visits never turn into an ad loop.
 * Fire-and-forget: callers must not await it before starting play. No-ops
 * while ads are disabled, on web, or when the native ads module is
 * unavailable.
 */
let didShowThisSession = false;

export function resetQuizStartInterstitialForTests(): void {
  didShowThisSession = false;
}

export function wasQuizStartInterstitialShown(): boolean {
  return didShowThisSession;
}

export interface QuizStartInterstitialOptions {
  /**
   * Polled before presenting a loaded interstitial. When it returns true the
   * load is abandoned as `skipped` instead of showing an ad over live play
   * or an unmounted lobby.
   */
  isCancelled?: () => boolean;
}

// biome-ignore lint/suspicious/useAwait: async wraps the early 'skipped' returns in the declared Promise.
export async function maybeShowQuizStartInterstitial(
  options: QuizStartInterstitialOptions = {}
): Promise<'shown' | 'skipped'> {
  if (didShowThisSession) {
    return 'skipped';
  }
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    return 'skipped';
  }

  let config: ReturnType<typeof getMobileAdUnitId>;
  try {
    config = getMobileAdUnitId('QUIZ_START_INTERSTITIAL');
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

  return new Promise<'shown' | 'skipped'>((resolve) => {
    let settled = false;
    const finish = (outcome: 'shown' | 'skipped') => {
      if (settled) return;
      settled = true;
      if (outcome === 'shown') {
        didShowThisSession = true;
        trackEvent('mobile_ad_impression', {
          format: 'interstitial',
          placement: 'QUIZ_START_INTERSTITIAL',
        });
      }
      resolve(outcome);
    };

    try {
      const interstitial = mobileAds.InterstitialAd.createForAdRequest(
        config.unitId
      );
      const cleanups = [
        interstitial.addAdEventListener(mobileAds.AdEventType.LOADED, () => {
          // The lobby may have moved into live play (or unmounted) while the
          // ad was loading; presenting now would steal timed-question time or
          // surface an ad on an unrelated screen.
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
        interstitial.addAdEventListener(mobileAds.AdEventType.CLOSED, () =>
          finish(didShowThisSession ? 'shown' : 'skipped')
        ),
      ];
      interstitial.load();
      setTimeout(() => {
        for (const unsubscribe of cleanups) unsubscribe();
        finish('skipped');
      }, 30_000);
    } catch {
      finish('skipped');
    }
  });
}
