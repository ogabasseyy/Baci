import { describe, expect, it } from '@jest/globals';
import { MOBILE_AD_ENV_KEYS } from './mobile-ad-env-keys';
import { readMobileAdDefaultEnvironment } from './mobile-ad-environment';

describe('readMobileAdDefaultEnvironment', () => {
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
