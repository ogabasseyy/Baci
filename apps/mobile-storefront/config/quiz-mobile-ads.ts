import { Platform } from 'react-native';

type QuizMobileAdsPlatform = 'android' | 'ios' | 'web';

type QuizMobileAdsEnvironment = Readonly<Record<string, string | undefined>>;

interface GetQuizMobileAdsConfigOptions {
  development?: boolean;
  environment?: QuizMobileAdsEnvironment;
  platform?: QuizMobileAdsPlatform;
}

export type QuizMobileAdsConfig =
  | { enabled: false }
  | { bannerUnitId: string; enabled: true; rewardedUnitId?: string };

const BANNER_UNIT_ID_PATTERN = /^ca-app-pub-\d+\/\d+$/;
const TEST_BANNER_UNIT_IDS = {
  android: 'ca-app-pub-3940256099942544/9214589741',
  ios: 'ca-app-pub-3940256099942544/2435281174',
} as const;
const TEST_REWARDED_UNIT_IDS = {
  android: 'ca-app-pub-3940256099942544/5224354917',
  ios: 'ca-app-pub-3940256099942544/1712485313',
} as const;
const TEST_BANNER_UNIT_ID_VALUES = new Set<string>(
  Object.values(TEST_BANNER_UNIT_IDS)
);
const TEST_REWARDED_UNIT_ID_VALUES = new Set<string>(
  Object.values(TEST_REWARDED_UNIT_IDS)
);

function getDefaultPlatform(): QuizMobileAdsPlatform {
  return Platform.OS === 'android' || Platform.OS === 'ios'
    ? Platform.OS
    : 'web';
}

export function getQuizMobileAdsConfig(
  options: GetQuizMobileAdsConfigOptions = {}
): QuizMobileAdsConfig {
  const environment = options.environment ?? {
    EXPO_PUBLIC_QUIZ_ADS_ENABLED: process.env.EXPO_PUBLIC_QUIZ_ADS_ENABLED,
    EXPO_PUBLIC_QUIZ_ADMOB_ANDROID_BANNER_UNIT_ID:
      process.env.EXPO_PUBLIC_QUIZ_ADMOB_ANDROID_BANNER_UNIT_ID,
    EXPO_PUBLIC_QUIZ_ADMOB_IOS_BANNER_UNIT_ID:
      process.env.EXPO_PUBLIC_QUIZ_ADMOB_IOS_BANNER_UNIT_ID,
    EXPO_PUBLIC_QUIZ_ADMOB_ANDROID_REWARDED_UNIT_ID:
      process.env.EXPO_PUBLIC_QUIZ_ADMOB_ANDROID_REWARDED_UNIT_ID,
    EXPO_PUBLIC_QUIZ_ADMOB_IOS_REWARDED_UNIT_ID:
      process.env.EXPO_PUBLIC_QUIZ_ADMOB_IOS_REWARDED_UNIT_ID,
  };
  if (environment.EXPO_PUBLIC_QUIZ_ADS_ENABLED !== 'true') {
    return { enabled: false };
  }

  const platform = options.platform ?? getDefaultPlatform();
  if (platform === 'web') return { enabled: false };

  const development = options.development ?? __DEV__;
  if (development) {
    return {
      bannerUnitId: TEST_BANNER_UNIT_IDS[platform],
      enabled: true,
      rewardedUnitId: TEST_REWARDED_UNIT_IDS[platform],
    };
  }

  const environmentKey =
    platform === 'android'
      ? 'EXPO_PUBLIC_QUIZ_ADMOB_ANDROID_BANNER_UNIT_ID'
      : 'EXPO_PUBLIC_QUIZ_ADMOB_IOS_BANNER_UNIT_ID';
  const bannerUnitId = (
    platform === 'android'
      ? environment.EXPO_PUBLIC_QUIZ_ADMOB_ANDROID_BANNER_UNIT_ID
      : environment.EXPO_PUBLIC_QUIZ_ADMOB_IOS_BANNER_UNIT_ID
  )?.trim();
  if (
    !bannerUnitId ||
    !BANNER_UNIT_ID_PATTERN.test(bannerUnitId) ||
    TEST_BANNER_UNIT_ID_VALUES.has(bannerUnitId)
  ) {
    throw new Error(
      `[quiz-mobile-ads] ${environmentKey} must be a non-sample Google Mobile Ads banner unit ID.`
    );
  }

  const rewardedUnitId = (
    platform === 'android'
      ? environment.EXPO_PUBLIC_QUIZ_ADMOB_ANDROID_REWARDED_UNIT_ID
      : environment.EXPO_PUBLIC_QUIZ_ADMOB_IOS_REWARDED_UNIT_ID
  )?.trim();
  const hasValidRewardedUnitId =
    Boolean(rewardedUnitId) &&
    BANNER_UNIT_ID_PATTERN.test(rewardedUnitId ?? '') &&
    !TEST_BANNER_UNIT_ID_VALUES.has(rewardedUnitId ?? '') &&
    !TEST_REWARDED_UNIT_ID_VALUES.has(rewardedUnitId ?? '');

  return {
    bannerUnitId,
    enabled: true,
    ...(hasValidRewardedUnitId ? { rewardedUnitId } : {}),
  };
}
