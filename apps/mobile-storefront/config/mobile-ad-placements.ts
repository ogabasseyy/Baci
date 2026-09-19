import { Platform } from 'react-native';
import {
  BANNER_PLACEMENT_ENV_KEYS,
  INTERSTITIAL_ENV_KEYS,
  type MobileAdBannerPlacementKey,
  type MobileAdFormat,
  type MobileAdPlacementKey,
  REWARDED_ENV_KEYS,
} from './mobile-ad-env-keys';
import {
  type MobileAdEnvironment,
  readMobileAdDefaultEnvironment,
} from './mobile-ad-environment';

export type {
  MobileAdBannerPlacementKey,
  MobileAdEnvironment,
  MobileAdFormat,
  MobileAdPlacementKey,
};

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

type MobileAdPlatform = 'android' | 'ios';

interface GetMobileAdUnitIdOptions {
  development?: boolean;
  environment?: MobileAdEnvironment;
  platform?: MobileAdPlatform | 'web';
}

export type MobileAdUnitConfig =
  | { enabled: false }
  | { enabled: true; format: MobileAdFormat; unitId: string };

const UNIT_ID_PATTERN = /^ca-app-pub-\d+\/\d+$/;

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
  const keys = BANNER_PLACEMENT_ENV_KEYS[key];
  return platform === 'android' ? keys.androidEnvKey : keys.iosEnvKey;
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
