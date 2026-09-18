import { Platform } from 'react-native';

/**
 * App-wide AdMob placement registry. Mirrors the web placement keys
 * (`HEADER_LEADERBOARD`, `CART_MPU`, `ORDER_SUCCESS_BANNER`, ...) so each
 * slot is independently configured and kill-switchable.
 *
 * Resolution rules:
 * - Global gate: `EXPO_PUBLIC_MOBILE_ADS_ENABLED === 'true'`.
 * - Development (`__DEV__`): Google sample unit IDs. No real IDs needed.
 * - Production: per-placement, per-platform unit IDs from env. Sample or
 *   missing IDs throw, matching the quiz config behavior.
 */

export type MobileAdBannerPlacementKey =
  | 'HOME_STRIP'
  | 'PRODUCT_GRID_IN_FEED'
  | 'PRODUCT_GRID_MPU'
  | 'CART_MPU'
  | 'ORDER_SUCCESS_BANNER'
  | 'FOOTER_ANCHOR';

export type MobileAdPlacementKey =
  | MobileAdBannerPlacementKey
  | 'POST_ORDER_INTERSTITIAL'
  | 'QUIZ_START_INTERSTITIAL'
  | 'REWARDED';

export type MobileAdFormat = 'banner' | 'interstitial' | 'rewarded';

type MobileAdPlatform = 'android' | 'ios';

type MobileAdEnvironment = Readonly<Record<string, string | undefined>>;

interface GetMobileAdUnitIdOptions {
  development?: boolean;
  environment?: MobileAdEnvironment;
  platform?: MobileAdPlatform | 'web';
}

export type MobileAdUnitConfig =
  | { enabled: false }
  | { enabled: true; format: MobileAdFormat; unitId: string };

const UNIT_ID_PATTERN = /^ca-app-pub-\d+\/\d+$/;

const BANNER_PLACEMENTS: Record<
  MobileAdBannerPlacementKey,
  { androidEnvKey: string; iosEnvKey: string }
> = {
  HOME_STRIP: {
    androidEnvKey: 'EXPO_PUBLIC_ADMOB_ANDROID_HOME_STRIP_UNIT_ID',
    iosEnvKey: 'EXPO_PUBLIC_ADMOB_IOS_HOME_STRIP_UNIT_ID',
  },
  PRODUCT_GRID_IN_FEED: {
    androidEnvKey: 'EXPO_PUBLIC_ADMOB_ANDROID_PRODUCT_GRID_IN_FEED_UNIT_ID',
    iosEnvKey: 'EXPO_PUBLIC_ADMOB_IOS_PRODUCT_GRID_IN_FEED_UNIT_ID',
  },
  PRODUCT_GRID_MPU: {
    androidEnvKey: 'EXPO_PUBLIC_ADMOB_ANDROID_PRODUCT_GRID_MPU_UNIT_ID',
    iosEnvKey: 'EXPO_PUBLIC_ADMOB_IOS_PRODUCT_GRID_MPU_UNIT_ID',
  },
  CART_MPU: {
    androidEnvKey: 'EXPO_PUBLIC_ADMOB_ANDROID_CART_MPU_UNIT_ID',
    iosEnvKey: 'EXPO_PUBLIC_ADMOB_IOS_CART_MPU_UNIT_ID',
  },
  ORDER_SUCCESS_BANNER: {
    androidEnvKey: 'EXPO_PUBLIC_ADMOB_ANDROID_ORDER_SUCCESS_BANNER_UNIT_ID',
    iosEnvKey: 'EXPO_PUBLIC_ADMOB_IOS_ORDER_SUCCESS_BANNER_UNIT_ID',
  },
  FOOTER_ANCHOR: {
    androidEnvKey: 'EXPO_PUBLIC_ADMOB_ANDROID_FOOTER_ANCHOR_UNIT_ID',
    iosEnvKey: 'EXPO_PUBLIC_ADMOB_IOS_FOOTER_ANCHOR_UNIT_ID',
  },
};

const INTERSTITIAL_ENV_KEYS: Record<
  'POST_ORDER_INTERSTITIAL' | 'QUIZ_START_INTERSTITIAL',
  { android: string; ios: string }
> = {
  POST_ORDER_INTERSTITIAL: {
    android: 'EXPO_PUBLIC_ADMOB_ANDROID_POST_ORDER_INTERSTITIAL_UNIT_ID',
    ios: 'EXPO_PUBLIC_ADMOB_IOS_POST_ORDER_INTERSTITIAL_UNIT_ID',
  },
  QUIZ_START_INTERSTITIAL: {
    android: 'EXPO_PUBLIC_ADMOB_ANDROID_QUIZ_START_INTERSTITIAL_UNIT_ID',
    ios: 'EXPO_PUBLIC_ADMOB_IOS_QUIZ_START_INTERSTITIAL_UNIT_ID',
  },
};

// Rewarded reuses the quiz rewarded units: one rewarded placement exists.
const REWARDED_ENV_KEYS = {
  android: 'EXPO_PUBLIC_QUIZ_ADMOB_ANDROID_REWARDED_UNIT_ID',
  ios: 'EXPO_PUBLIC_QUIZ_ADMOB_IOS_REWARDED_UNIT_ID',
} as const;

const SAMPLE_UNIT_IDS: Record<
  MobileAdFormat,
  Record<'android' | 'ios', string>
> = {
  banner: {
    android: 'ca-app-pub-3940256099942544/9214589741',
    ios: 'ca-app-pub-3940256099942544/2435281174',
  },
  interstitial: {
    android: 'ca-app-pub-3940256099942544/1033173712',
    ios: 'ca-app-pub-3940256099942544/4411468910',
  },
  rewarded: {
    android: 'ca-app-pub-3940256099942544/5224354917',
    ios: 'ca-app-pub-3940256099942544/1712485313',
  },
};

const SAMPLE_UNIT_ID_VALUES = new Set(
  Object.values(SAMPLE_UNIT_IDS).flatMap((perPlatform) =>
    Object.values(perPlatform)
  )
);

function getDefaultPlatform(): MobileAdPlatform | 'web' {
  return Platform.OS === 'android' || Platform.OS === 'ios'
    ? Platform.OS
    : 'web';
}

function placementFormat(key: MobileAdPlacementKey): MobileAdFormat {
  if (key === 'POST_ORDER_INTERSTITIAL' || key === 'QUIZ_START_INTERSTITIAL')
    return 'interstitial';
  if (key === 'REWARDED') return 'rewarded';
  return 'banner';
}

function placementEnvKey(
  key: MobileAdPlacementKey,
  platform: MobileAdPlatform
): string {
  if (key === 'POST_ORDER_INTERSTITIAL' || key === 'QUIZ_START_INTERSTITIAL') {
    return INTERSTITIAL_ENV_KEYS[key][platform];
  }
  if (key === 'REWARDED') {
    return REWARDED_ENV_KEYS[platform];
  }
  const keys = BANNER_PLACEMENTS[key];
  return platform === 'android' ? keys.androidEnvKey : keys.iosEnvKey;
}

/**
 * Every `EXPO_PUBLIC_*` variable the placement registry can look up.
 * Exported so tests can assert the static reader below stays in sync when
 * placements are added.
 */
export const MOBILE_AD_ENV_KEYS: readonly string[] = [
  'EXPO_PUBLIC_MOBILE_ADS_ENABLED',
  ...Object.values(BANNER_PLACEMENTS).flatMap((keys) => [
    keys.androidEnvKey,
    keys.iosEnvKey,
  ]),
  ...Object.values(INTERSTITIAL_ENV_KEYS).flatMap((keys) => [
    keys.android,
    keys.ios,
  ]),
  REWARDED_ENV_KEYS.android,
  REWARDED_ENV_KEYS.ios,
];

/**
 * Default environment snapshot. Every variable is read with static
 * `process.env.EXPO_PUBLIC_*` dot notation because Expo only inlines
 * statically referenced variables into release bundles — computed
 * `process.env[key]` reads stay undefined in production and would disable
 * every placement (or throw for uncaught callers). Callers that need a
 * synthetic environment (tests, previews) pass `options.environment`.
 *
 * When adding a placement, add its variables here AND to
 * MOBILE_AD_ENV_KEYS (covered by `mobile-ad-placements.test.ts`).
 */
export function readMobileAdDefaultEnvironment(): MobileAdEnvironment {
  return {
    EXPO_PUBLIC_MOBILE_ADS_ENABLED: process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED,
    EXPO_PUBLIC_ADMOB_ANDROID_HOME_STRIP_UNIT_ID:
      process.env.EXPO_PUBLIC_ADMOB_ANDROID_HOME_STRIP_UNIT_ID,
    EXPO_PUBLIC_ADMOB_IOS_HOME_STRIP_UNIT_ID:
      process.env.EXPO_PUBLIC_ADMOB_IOS_HOME_STRIP_UNIT_ID,
    EXPO_PUBLIC_ADMOB_ANDROID_PRODUCT_GRID_IN_FEED_UNIT_ID:
      process.env.EXPO_PUBLIC_ADMOB_ANDROID_PRODUCT_GRID_IN_FEED_UNIT_ID,
    EXPO_PUBLIC_ADMOB_IOS_PRODUCT_GRID_IN_FEED_UNIT_ID:
      process.env.EXPO_PUBLIC_ADMOB_IOS_PRODUCT_GRID_IN_FEED_UNIT_ID,
    EXPO_PUBLIC_ADMOB_ANDROID_PRODUCT_GRID_MPU_UNIT_ID:
      process.env.EXPO_PUBLIC_ADMOB_ANDROID_PRODUCT_GRID_MPU_UNIT_ID,
    EXPO_PUBLIC_ADMOB_IOS_PRODUCT_GRID_MPU_UNIT_ID:
      process.env.EXPO_PUBLIC_ADMOB_IOS_PRODUCT_GRID_MPU_UNIT_ID,
    EXPO_PUBLIC_ADMOB_ANDROID_CART_MPU_UNIT_ID:
      process.env.EXPO_PUBLIC_ADMOB_ANDROID_CART_MPU_UNIT_ID,
    EXPO_PUBLIC_ADMOB_IOS_CART_MPU_UNIT_ID:
      process.env.EXPO_PUBLIC_ADMOB_IOS_CART_MPU_UNIT_ID,
    EXPO_PUBLIC_ADMOB_ANDROID_ORDER_SUCCESS_BANNER_UNIT_ID:
      process.env.EXPO_PUBLIC_ADMOB_ANDROID_ORDER_SUCCESS_BANNER_UNIT_ID,
    EXPO_PUBLIC_ADMOB_IOS_ORDER_SUCCESS_BANNER_UNIT_ID:
      process.env.EXPO_PUBLIC_ADMOB_IOS_ORDER_SUCCESS_BANNER_UNIT_ID,
    EXPO_PUBLIC_ADMOB_ANDROID_FOOTER_ANCHOR_UNIT_ID:
      process.env.EXPO_PUBLIC_ADMOB_ANDROID_FOOTER_ANCHOR_UNIT_ID,
    EXPO_PUBLIC_ADMOB_IOS_FOOTER_ANCHOR_UNIT_ID:
      process.env.EXPO_PUBLIC_ADMOB_IOS_FOOTER_ANCHOR_UNIT_ID,
    EXPO_PUBLIC_ADMOB_ANDROID_POST_ORDER_INTERSTITIAL_UNIT_ID:
      process.env.EXPO_PUBLIC_ADMOB_ANDROID_POST_ORDER_INTERSTITIAL_UNIT_ID,
    EXPO_PUBLIC_ADMOB_IOS_POST_ORDER_INTERSTITIAL_UNIT_ID:
      process.env.EXPO_PUBLIC_ADMOB_IOS_POST_ORDER_INTERSTITIAL_UNIT_ID,
    EXPO_PUBLIC_ADMOB_ANDROID_QUIZ_START_INTERSTITIAL_UNIT_ID:
      process.env.EXPO_PUBLIC_ADMOB_ANDROID_QUIZ_START_INTERSTITIAL_UNIT_ID,
    EXPO_PUBLIC_ADMOB_IOS_QUIZ_START_INTERSTITIAL_UNIT_ID:
      process.env.EXPO_PUBLIC_ADMOB_IOS_QUIZ_START_INTERSTITIAL_UNIT_ID,
    EXPO_PUBLIC_QUIZ_ADMOB_ANDROID_REWARDED_UNIT_ID:
      process.env.EXPO_PUBLIC_QUIZ_ADMOB_ANDROID_REWARDED_UNIT_ID,
    EXPO_PUBLIC_QUIZ_ADMOB_IOS_REWARDED_UNIT_ID:
      process.env.EXPO_PUBLIC_QUIZ_ADMOB_IOS_REWARDED_UNIT_ID,
  };
}

export function getMobileAdUnitId(
  key: MobileAdPlacementKey,
  options: GetMobileAdUnitIdOptions = {}
): MobileAdUnitConfig {
  const environment: MobileAdEnvironment =
    options.environment ?? readMobileAdDefaultEnvironment();

  if (environment.EXPO_PUBLIC_MOBILE_ADS_ENABLED !== 'true') {
    return { enabled: false };
  }

  const format = placementFormat(key);
  const platform = options.platform ?? getDefaultPlatform();
  if (platform === 'web') return { enabled: false };

  const development = options.development ?? __DEV__;
  if (development) {
    return { enabled: true, format, unitId: SAMPLE_UNIT_IDS[format][platform] };
  }

  const envKey = placementEnvKey(key, platform);
  const unitId = environment[envKey]?.trim();
  if (
    !unitId ||
    !UNIT_ID_PATTERN.test(unitId) ||
    SAMPLE_UNIT_ID_VALUES.has(unitId)
  ) {
    throw new Error(
      `[mobile-ads] ${envKey} must be a non-sample Google Mobile Ads unit ID.`
    );
  }
  return { enabled: true, format, unitId };
}
