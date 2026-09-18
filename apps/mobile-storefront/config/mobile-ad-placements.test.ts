import { describe, expect, it } from '@jest/globals';
import {
  getMobileAdUnitId,
  MOBILE_AD_ENV_KEYS,
  readMobileAdDefaultEnvironment,
} from './mobile-ad-placements';

const ENABLED_ENV = { EXPO_PUBLIC_MOBILE_ADS_ENABLED: 'true' };

describe('getMobileAdUnitId', () => {
  it('is disabled without the global flag', () => {
    expect(
      getMobileAdUnitId('HOME_STRIP', {
        development: true,
        environment: {},
        platform: 'android',
      })
    ).toEqual({ enabled: false });
  });

  it('is disabled on web', () => {
    expect(
      getMobileAdUnitId('HOME_STRIP', {
        development: true,
        environment: ENABLED_ENV,
        platform: 'web',
      })
    ).toEqual({ enabled: false });
  });

  it('returns Google sample banner IDs in development', () => {
    expect(
      getMobileAdUnitId('CART_MPU', {
        development: true,
        environment: ENABLED_ENV,
        platform: 'android',
      })
    ).toEqual({
      enabled: true,
      format: 'banner',
      unitId: 'ca-app-pub-3940256099942544/9214589741',
    });
    expect(
      getMobileAdUnitId('FOOTER_ANCHOR', {
        development: true,
        environment: ENABLED_ENV,
        platform: 'ios',
      })
    ).toEqual({
      enabled: true,
      format: 'banner',
      unitId: 'ca-app-pub-3940256099942544/2435281174',
    });
  });

  it('returns the sample interstitial ID for the post-order placement in development', () => {
    const config = getMobileAdUnitId('POST_ORDER_INTERSTITIAL', {
      development: true,
      environment: ENABLED_ENV,
      platform: 'android',
    });
    expect(config).toEqual({
      enabled: true,
      format: 'interstitial',
      unitId: 'ca-app-pub-3940256099942544/1033173712',
    });
  });

  it('returns the sample interstitial ID for the quiz-start placement in development', () => {
    const config = getMobileAdUnitId('QUIZ_START_INTERSTITIAL', {
      development: true,
      environment: ENABLED_ENV,
      platform: 'ios',
    });
    expect(config).toEqual({
      enabled: true,
      format: 'interstitial',
      unitId: 'ca-app-pub-3940256099942544/4411468910',
    });
  });

  it('resolves the quiz-start placement from its own production unit ID', () => {
    const config = getMobileAdUnitId('QUIZ_START_INTERSTITIAL', {
      development: false,
      environment: {
        ...ENABLED_ENV,
        EXPO_PUBLIC_ADMOB_ANDROID_QUIZ_START_INTERSTITIAL_UNIT_ID:
          'ca-app-pub-9332275663101466/1111111111',
      },
      platform: 'android',
    });
    expect(config).toEqual({
      enabled: true,
      format: 'interstitial',
      unitId: 'ca-app-pub-9332275663101466/1111111111',
    });
  });

  it('resolves each banner placement from its own production unit ID', () => {
    const config = getMobileAdUnitId('ORDER_SUCCESS_BANNER', {
      development: false,
      environment: {
        ...ENABLED_ENV,
        EXPO_PUBLIC_ADMOB_ANDROID_ORDER_SUCCESS_BANNER_UNIT_ID:
          'ca-app-pub-9332275663101466/2220129292',
      },
      platform: 'android',
    });
    expect(config).toEqual({
      enabled: true,
      format: 'banner',
      unitId: 'ca-app-pub-9332275663101466/2220129292',
    });
  });

  it('rejects sample production unit IDs', () => {
    expect(() =>
      getMobileAdUnitId('HOME_STRIP', {
        development: false,
        environment: {
          ...ENABLED_ENV,
          EXPO_PUBLIC_ADMOB_ANDROID_HOME_STRIP_UNIT_ID:
            'ca-app-pub-3940256099942544/9214589741',
        },
        platform: 'android',
      })
    ).toThrow('[mobile-ads]');
  });

  it('rejects missing production unit IDs', () => {
    expect(() =>
      getMobileAdUnitId('CART_MPU', {
        development: false,
        environment: ENABLED_ENV,
        platform: 'ios',
      })
    ).toThrow('[mobile-ads]');
  });

  it('statically reads every registry variable so release bundles inline them', () => {
    // Expo only inlines `process.env.EXPO_PUBLIC_*` referenced with static
    // dot notation; a missing key here stays undefined in production and
    // silently disables (or throws for) that placement.
    const environment = readMobileAdDefaultEnvironment();
    expect(new Set(MOBILE_AD_ENV_KEYS).size).toBe(MOBILE_AD_ENV_KEYS.length);
    for (const key of MOBILE_AD_ENV_KEYS) {
      expect(environment).toHaveProperty(key);
    }
    expect(Object.keys(environment).sort()).toEqual(
      [...MOBILE_AD_ENV_KEYS].sort()
    );
  });
});
