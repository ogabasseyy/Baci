import { Platform } from 'react-native';
import { getMobileAdUnitId } from '@/config/mobile-ad-placements';
import { trackEvent } from '@/services/analytics-core';

/**
 * Post-order interstitial, capped to one presentation per app session so a
 * purchase celebration never turns into an ad loop. No-ops while ads are
 * disabled, on web, or when the native ads module is unavailable.
 */
let didShowThisSession = false;

export function resetPostOrderInterstitialForTests(): void {
  didShowThisSession = false;
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
          placement: 'POST_ORDER_INTERSTITIAL',
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
