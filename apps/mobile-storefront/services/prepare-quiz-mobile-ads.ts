import { isQuizMobileAdsAvailable } from '@/components/quiz/is-quiz-mobile-ads-available';
import { getQuizMobileAdsConfig } from '@/config/quiz-mobile-ads';
import { getFeatureFlagValue } from '@/services/analytics-core';
import {
  initializeQuizMobileAds,
  prepareQuizMobileAdsConsent,
  type QuizMobileAdsInitializationOptions,
} from './initialize-quiz-mobile-ads';

export type PrepareQuizMobileAds = ((
  signal?: AbortSignal,
  options?: QuizMobileAdsInitializationOptions
) => Promise<boolean>) & {
  prepareConsent?: () => Promise<void>;
};

async function prepareConsentBeforeStart(): Promise<void> {
  try {
    const config = getQuizMobileAdsConfig();
    if (!config.enabled || !isQuizMobileAdsAvailable()) return;
    const enabled = await getFeatureFlagValue('quiz-mobile-ads');
    if (enabled === false) return;
    await prepareQuizMobileAdsConsent();
  } catch {
    // The normal preparation path remains responsible for optional ad errors.
  }
}

/**
 * Prepares consent and the native ads SDK before the timed attempt starts.
 * Ads are optional: configuration, native-module, consent, and SDK failures
 * must never prevent a shopper from starting the quiz. The boolean result is
 * used by the start flow to prevent a second consent/SDK attempt once timed
 * gameplay has begun.
 */
async function prepareQuizMobileAdsImpl(
  signal?: AbortSignal,
  options?: QuizMobileAdsInitializationOptions
): Promise<boolean> {
  try {
    if (signal?.aborted) return false;
    const config = getQuizMobileAdsConfig();
    if (!config.enabled || !isQuizMobileAdsAvailable()) return true;
    const enabled = await getFeatureFlagValue('quiz-mobile-ads');
    if (signal?.aborted) return false;
    if (enabled === false) return true;
    await initializeQuizMobileAds(signal, options);
    return !signal?.aborted;
  } catch {
    // Gameplay remains available when ads cannot be prepared on this client.
    return false;
  }
}

export const prepareQuizMobileAds: PrepareQuizMobileAds = Object.assign(
  prepareQuizMobileAdsImpl,
  { prepareConsent: prepareConsentBeforeStart }
);
