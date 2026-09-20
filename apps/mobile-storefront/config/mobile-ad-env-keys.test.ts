import { describe, expect, it } from '@jest/globals';
import {
  BANNER_PLACEMENT_ENV_KEYS,
  INTERSTITIAL_ENV_KEYS,
  MOBILE_AD_ENV_KEYS,
  type MobileAdBannerPlacementKey,
  REWARDED_ENV_KEYS,
} from './mobile-ad-env-keys';

const BANNER_KEYS: MobileAdBannerPlacementKey[] = [
  'HOME_STRIP',
  'PRODUCT_GRID_IN_FEED',
  'PRODUCT_GRID_MPU',
  'CART_MPU',
  'ORDER_SUCCESS_BANNER',
  'FOOTER_ANCHOR',
];

describe('MOBILE_AD_ENV_KEYS', () => {
  it('lists every registry variable exactly once', () => {
    // Arrange & Act & Assert
    expect(new Set(MOBILE_AD_ENV_KEYS).size).toBe(MOBILE_AD_ENV_KEYS.length);
    for (const key of MOBILE_AD_ENV_KEYS) {
      expect(key.startsWith('EXPO_PUBLIC_')).toBe(true);
    }
  });

  it('covers every banner placement on both platforms', () => {
    // Arrange & Act & Assert: a placement missing here silently disables
    // in production when the resolver looks up its unit ID.
    for (const placement of BANNER_KEYS) {
      expect(BANNER_PLACEMENT_ENV_KEYS[placement].androidEnvKey).toContain(
        'ANDROID'
      );
      expect(BANNER_PLACEMENT_ENV_KEYS[placement].iosEnvKey).toContain('IOS');
    }
    expect(INTERSTITIAL_ENV_KEYS.POST_ORDER_INTERSTITIAL.android).toContain(
      'ANDROID'
    );
    expect(REWARDED_ENV_KEYS.ios).toContain('IOS');
  });
});
