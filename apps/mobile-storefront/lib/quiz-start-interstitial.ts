import { Platform } from 'react-native';
import type { PaidEvent } from 'react-native-google-mobile-ads';
import { isQuizMobileAdsAvailable } from '@/components/quiz/is-quiz-mobile-ads-available';
import { getMobileAdUnitId } from '@/config/mobile-ad-placements';
import { trackEvent } from '@/services/analytics-core';
import { initializeQuizMobileAds } from '@/services/initialize-quiz-mobile-ads';
import { trackInterstitialPaidEvent } from './interstitial-paid-event';
import { isQuizRewardedFlowActive } from './quiz-fullscreen-ownership';

/**
 * Pre-quiz interstitial, shown when the waiting room opens and capped to one
 * presentation per app session so lobby visits never turn into an ad loop.
 * Fire-and-forget: callers must not await it before starting play. No-ops
 * while ads are disabled, on web, or when the native ads module is
 * unavailable.
 */
let didShowThisSession = false;
// Attempt lifecycle: 'idle' (session cap free), 'loading' (reservation held
// while consent/SDK init and the ad load are in flight, so overlapping lobby
// visits must not create a second interstitial), 'owned' (LOADED fired and
// the attempt is claimed through presentation, so a load finishing just
// before the deadline cannot release the cap and allow a second
// presentation in the same session).
type QuizStartAttemptState = 'idle' | 'loading' | 'owned';
let attemptState: QuizStartAttemptState = 'idle';

export function resetQuizStartInterstitialForTests(): void {
  didShowThisSession = false;
  attemptState = 'idle';
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
  /**
   * Invoked when a presented interstitial closes so hosts can remount
   * banner slots withheld while the full-screen ad owned the screen.
   */
  onClosed?: () => void;
  /**
   * Invoked synchronously when LOADED claims the attempt and presentation
   * begins, before the show() bridge round-trip resolves. Hosts claim
   * fullscreen ownership here so a start boundary landing in that window
   * holds instead of starting behind the presenting ad.
   */
  onPresenting?: () => void;
}

export async function maybeShowQuizStartInterstitial(
  options: QuizStartInterstitialOptions = {}
): Promise<'shown' | 'skipped'> {
  if (didShowThisSession || attemptState !== 'idle') {
    return 'skipped';
  }
  // Reserve the session cap synchronously: the consent/SDK initialization
  // below awaits, and a second invocation arriving during that window must
  // see the reservation instead of loading a second interstitial.
  attemptState = 'loading';

  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    attemptState = 'idle';
    return 'skipped';
  }

  let config: ReturnType<typeof getMobileAdUnitId>;
  try {
    config = getMobileAdUnitId('QUIZ_START_INTERSTITIAL');
  } catch {
    attemptState = 'idle';
    return 'skipped';
  }
  if (!config.enabled || config.format !== 'interstitial') {
    attemptState = 'idle';
    return 'skipped';
  }

  // Consent gate: never request the interstitial before UMP consent is
  // gathered and the protective under-age configuration is applied.
  try {
    if (!isQuizMobileAdsAvailable()) {
      attemptState = 'idle';
      return 'skipped';
    }
    const { canRequestAds } = await initializeQuizMobileAds();
    if (!canRequestAds) {
      attemptState = 'idle';
      return 'skipped';
    }
  } catch {
    attemptState = 'idle';
    return 'skipped';
  }

  let mobileAds: typeof import('react-native-google-mobile-ads') | null = null;
  try {
    mobileAds =
      require('react-native-google-mobile-ads') as typeof import('react-native-google-mobile-ads');
  } catch {
    attemptState = 'idle';
    return 'skipped';
  }
  if (!mobileAds) {
    attemptState = 'idle';
    return 'skipped';
  }

  // Recheck the cap after the awaited initialization: a finished attempt
  // must not be followed by a second presentation in the same session.
  if (didShowThisSession) {
    attemptState = 'idle';
    return 'skipped';
  }

  return new Promise<'shown' | 'skipped'>((resolve) => {
    let settled = false;
    let loadTimer: ReturnType<typeof setTimeout> | null = null;
    const cleanups: Array<() => void> = [];
    // Idempotent release: dismissal and owned-presentation failure both
    // land here, and CLOSED can race an already-settled show().
    const unsubscribeAll = () => {
      for (const unsubscribe of cleanups) unsubscribe();
      cleanups.length = 0;
    };
    // Pre-presentation exits release the loading reservation without
    // consuming the session cap: a failed, cancelled, timed-out, or
    // rewarded-preempted load must leave a later lobby visit able to show
    // the interstitial.
    const abandon = () => {
      if (settled) return;
      settled = true;
      if (loadTimer !== null) {
        clearTimeout(loadTimer);
        loadTimer = null;
      }
      unsubscribeAll();
      attemptState = 'idle';
      resolve('skipped');
    };
    // Presentation claims the session cap even when it ends as 'skipped':
    // once LOADED fires the attempt is owned through show()/close.
    const finish = (outcome: 'shown' | 'skipped') => {
      if (settled) return;
      settled = true;
      if (loadTimer !== null) {
        clearTimeout(loadTimer);
        loadTimer = null;
      }
      attemptState = 'owned';
      if (outcome === 'shown') {
        didShowThisSession = true;
        trackEvent('mobile_ad_impression', {
          format: 'interstitial',
          placement: 'QUIZ_START_INTERSTITIAL',
        });
      }
      resolve(outcome);
    };
    // An owned attempt whose presentation fails never produces CLOSED, so
    // no dismissal will arrive to release its listeners; unsubscribe now
    // while the session cap stays consumed.
    const failOwnedPresentation = () => {
      unsubscribeAll();
      finish('skipped');
    };

    try {
      const interstitial = mobileAds.InterstitialAd.createForAdRequest(
        config.unitId
      );
      // The deadline below guards the load phase only (see finish): a load
      // that never completes releases the reservation for a later visit.
      loadTimer = setTimeout(() => {
        loadTimer = null;
        abandon();
      }, 30_000);
      cleanups.push(
        interstitial.addAdEventListener(mobileAds.AdEventType.LOADED, () => {
          // A LOADED racing a fired deadline must not present: the deadline
          // already abandoned the attempt and unsubscribed this listener.
          if (settled) return;
          // The lobby may have moved into live play (or unmounted) while the
          // ad was loading; presenting now would steal timed-question time or
          // surface an ad on an unrelated screen. The rewarded-badge flow
          // likewise owns the full screen while loading or presented.
          if (options.isCancelled?.() || isQuizRewardedFlowActive()) {
            abandon();
            return;
          }
          // Claim the session cap before presenting: from here the attempt
          // is owned through show()/close even if presentation fails.
          attemptState = 'owned';
          if (loadTimer !== null) {
            clearTimeout(loadTimer);
            loadTimer = null;
          }
          try {
            // Claim host ownership synchronously: show() resolves over a
            // native bridge round-trip after presentation begins, and a
            // start boundary landing in that window must already see the
            // presenting ad. Inside try so a host throw degrades to an
            // owned-presentation failure instead of a stuck attempt.
            options.onPresenting?.();
            void interstitial
              .show()
              .then(() => finish('shown'), failOwnedPresentation);
          } catch {
            failOwnedPresentation();
          }
        }),
        interstitial.addAdEventListener(mobileAds.AdEventType.ERROR, () =>
          abandon()
        ),
        interstitial.addAdEventListener(mobileAds.AdEventType.PAID, (payload) =>
          trackInterstitialPaidEvent(
            'QUIZ_START_INTERSTITIAL',
            // The SDK types the PAID payload as undefined, but the native
            // bridge delivers { currency, precision, value } for
            // full-screen ads (verified in the installed v16 sources).
            payload as unknown as PaidEvent
          )
        ),
        interstitial.addAdEventListener(mobileAds.AdEventType.CLOSED, () => {
          // Dismissal ends the owned attempt: no further SDK events can
          // arrive, so release every listener (including this one) instead
          // of leaving native subscriptions installed after dismissal.
          unsubscribeAll();
          options.onClosed?.();
          finish(didShowThisSession ? 'shown' : 'skipped');
        })
      );
      interstitial.load();
    } catch {
      // A synchronous setup throw (createForAdRequest, addAdEventListener,
      // or load) must release the timer and any installed listeners exactly
      // like a load error; abandon() is settled-guarded and safe when
      // nothing was installed yet.
      abandon();
    }
  });
}
