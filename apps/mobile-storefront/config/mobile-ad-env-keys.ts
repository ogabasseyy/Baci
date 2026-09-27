/**
 * Placement keys, formats, and the environment-variable inventory for the
 * mobile AdMob registry. The inventory exists so tests can assert the
 * static snapshot reader stays in sync when placements are added.
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

export const BANNER_PLACEMENT_ENV_KEYS: Record<
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

export const INTERSTITIAL_ENV_KEYS: Record<
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
export const REWARDED_ENV_KEYS = {
  android: 'EXPO_PUBLIC_QUIZ_ADMOB_ANDROID_REWARDED_UNIT_ID',
  ios: 'EXPO_PUBLIC_QUIZ_ADMOB_IOS_REWARDED_UNIT_ID',
} as const;

/**
 * Every `EXPO_PUBLIC_*` variable the placement registry can look up.
 * Exported so tests can assert the static reader stays in sync when
 * placements are added.
 */
export const MOBILE_AD_ENV_KEYS: readonly string[] = [
  'EXPO_PUBLIC_MOBILE_ADS_ENABLED',
  ...Object.values(BANNER_PLACEMENT_ENV_KEYS).flatMap((keys) => [
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
