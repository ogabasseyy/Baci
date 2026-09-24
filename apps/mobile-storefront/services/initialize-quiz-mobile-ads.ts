import { getQuizMobileAdsConfig } from '@/config/quiz-mobile-ads';
import { createLogger } from '@/lib/logger';
import { getFeatureFlagValue } from './analytics-core';

interface QuizMobileAdsInitializationResult {
  canRequestAds: boolean;
}

const log = createLogger('QuizMobileAds');
let initializationPromise: Promise<QuizMobileAdsInitializationResult> | null =
  null;

async function initialize(): Promise<QuizMobileAdsInitializationResult> {
  const {
    default: mobileAds,
    AdsConsent,
    MaxAdContentRating,
  } = require('react-native-google-mobile-ads') as typeof import('react-native-google-mobile-ads');

  try {
    await AdsConsent.gatherConsent();
  } catch {
    log.warn(
      'Consent refresh unavailable; checking the previous consent state.'
    );
  }

  const { canRequestAds } = await AdsConsent.getConsentInfo();
  if (!canRequestAds) return { canRequestAds: false };

  const ads = mobileAds();
  await ads.setRequestConfiguration({
    maxAdContentRating: MaxAdContentRating.T,
    tagForChildDirectedTreatment: false,
    tagForUnderAgeOfConsent: false,
    testDeviceIdentifiers: __DEV__ ? ['EMULATOR'] : [],
  });
  await ads.initialize();

  return { canRequestAds: true };
}

export function initializeQuizMobileAds(): Promise<QuizMobileAdsInitializationResult> {
  if (!initializationPromise) {
    initializationPromise = initialize().catch((error) => {
      initializationPromise = null;
      throw error;
    });
  }
  return initializationPromise;
}

export async function ensureQuizMobileAdsReady(): Promise<void> {
  if (!getQuizMobileAdsConfig().enabled) return;
  const runtimeFlag = await getFeatureFlagValue('quiz-mobile-ads');
  if (runtimeFlag === false) return;
  await initializeQuizMobileAds().catch(() => null);
}
