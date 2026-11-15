import { isQuizMobileAdsAvailable } from '@/components/quiz/is-quiz-mobile-ads-available';
import {
  getQuizMobileAdsConsentStage,
  prepareQuizMobileAdsConsent,
} from './initialize-quiz-mobile-ads';

/**
 * While the consent request is only updating over the network nothing is on
 * screen, so a stall there must not hold the tracking prompt for long.
 */
export const CONSENT_UPDATE_WATCHDOG_MS = 10_000;

/**
 * Once Google's message may be showing, a person is reading it and the
 * prompt waits for them. This backstop only exists so a wedged native call
 * can never hold the prompt (and the startup work behind it) forever. The
 * `form` stage starts when the form is requested, not when it is shown, and
 * the library gives no signal for the difference, so a stalled form load is
 * bounded by this value too: keep it short enough to be a tolerable stall.
 */
export const CONSENT_FORM_BACKSTOP_MS = 120_000;

export type ConsentBeforeTrackingOutcome =
  | 'done'
  | 'error'
  | 'fallback'
  | 'skipped'
  | 'timeout';

function areMobileAdsEnabled(): boolean {
  // Static dot notation: Expo only inlines statically referenced variables.
  return (
    process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED === 'true' ||
    process.env.EXPO_PUBLIC_QUIZ_ADS_ENABLED === 'true'
  );
}

/**
 * Google's consent message (which carries the explainer for Apple's
 * tracking prompt) must come before the prompt itself. Left alone the two
 * run the other way round: the prompt fires at launch and the message only
 * appears when the first ad loads.
 *
 * Reuses the consent call every ad placement already shares, so the message
 * is shown once. Never rejects, and resolves without waiting when ads are
 * off or the ads module is missing, so the tracking prompt always runs.
 */
function positiveFinite(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export async function gatherConsentBeforeTracking(
  requestedWatchdogMs: number = CONSENT_UPDATE_WATCHDOG_MS,
  requestedBackstopMs: number = CONSENT_FORM_BACKSTOP_MS
): Promise<ConsentBeforeTrackingOutcome> {
  // These control a launch-blocking wait, so bad values fall back to the
  // defaults and the backstop can never be shorter than the watchdog.
  const updateWatchdogMs = positiveFinite(
    requestedWatchdogMs,
    CONSENT_UPDATE_WATCHDOG_MS
  );
  const formBackstopMs = Math.max(
    positiveFinite(requestedBackstopMs, CONSENT_FORM_BACKSTOP_MS),
    updateWatchdogMs
  );
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let backstop: ReturnType<typeof setTimeout> | null = null;
  try {
    if (!areMobileAdsEnabled() || !isQuizMobileAdsAvailable()) {
      return 'skipped';
    }
    // The consent promise that loses this race is left running on purpose:
    // native consent calls cannot be cancelled, it never rejects (errors are
    // absorbed inside prepareQuizMobileAdsConsent), and later ad placements
    // share it.
    return await Promise.race<ConsentBeforeTrackingOutcome>([
      prepareQuizMobileAdsConsent().then(() =>
        // A refresh that failed falls back to the previous consent state.
        getQuizMobileAdsConsentStage() === 'failed'
          ? ('fallback' as const)
          : ('done' as const)
      ),
      new Promise<ConsentBeforeTrackingOutcome>((resolve) => {
        watchdog = setTimeout(() => {
          // Nothing on screen yet: give up. Otherwise a person may be
          // reading the message, so keep waiting up to the backstop.
          const stage = getQuizMobileAdsConsentStage();
          if (stage === 'idle' || stage === 'updating') {
            resolve('timeout');
            return;
          }
          backstop = setTimeout(
            () => resolve('timeout'),
            Math.max(formBackstopMs - updateWatchdogMs, 0)
          );
        }, updateWatchdogMs);
      }),
    ]);
  } catch {
    return 'error';
  } finally {
    if (watchdog !== null) clearTimeout(watchdog);
    if (backstop !== null) clearTimeout(backstop);
  }
}
