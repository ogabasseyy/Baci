import { isQuizMobileAdsAvailable } from '@/components/quiz/is-quiz-mobile-ads-available';
import { prepareQuizMobileAdsConsent } from './initialize-quiz-mobile-ads';

/**
 * Upper bound on the consent step that runs ahead of Apple's tracking
 * prompt. Generous on purpose: the step includes the time a shopper spends
 * reading Google's message, and a prompt arriving on top of that message is
 * worse than a late one. It exists so a hung consent call can never keep
 * the tracking prompt (and the startup work waiting on it) from running.
 */
export const CONSENT_BEFORE_TRACKING_TIMEOUT_MS = 60_000;

export type ConsentBeforeTrackingOutcome =
  | 'done'
  | 'error'
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
export async function gatherConsentBeforeTracking(
  timeoutMs: number = CONSENT_BEFORE_TRACKING_TIMEOUT_MS
): Promise<ConsentBeforeTrackingOutcome> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    if (!areMobileAdsEnabled() || !isQuizMobileAdsAvailable()) {
      return 'skipped';
    }
    return await Promise.race<ConsentBeforeTrackingOutcome>([
      prepareQuizMobileAdsConsent().then(() => 'done' as const),
      new Promise<ConsentBeforeTrackingOutcome>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), timeoutMs);
      }),
    ]);
  } catch {
    return 'error';
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
