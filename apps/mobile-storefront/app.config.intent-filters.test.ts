import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { ConfigContext, ExpoConfig } from 'expo/config';

jest.mock('dotenv/config', () => ({}));

const originalEnv = process.env;

function loadAppConfig() {
  jest.resetModules();
  process.env = { ...originalEnv };
  delete process.env.EXPO_PUBLIC_QUIZ_ADS_ENABLED;
  delete process.env.EXPO_PUBLIC_QUIZ_ADMOB_ANDROID_BANNER_UNIT_ID;
  delete process.env.EXPO_PUBLIC_QUIZ_ADMOB_ANDROID_INTERSTITIAL_UNIT_ID;
  delete process.env.EXPO_PUBLIC_QUIZ_ADMOB_IOS_BANNER_UNIT_ID;
  delete process.env.EXPO_PUBLIC_QUIZ_ADMOB_IOS_INTERSTITIAL_UNIT_ID;
  delete process.env.STOREFRONT_ADMOB_ANDROID_APP_ID;
  delete process.env.STOREFRONT_ADMOB_IOS_APP_ID;
  delete process.env.STOREFRONT_FACEBOOK_APP_ID;
  delete process.env.STOREFRONT_FACEBOOK_CLIENT_TOKEN;
  delete process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
  process.env.STOREFRONT_FACEBOOK_APP_ID = '123456789';
  process.env.STOREFRONT_FACEBOOK_CLIENT_TOKEN = 'client-token';
  process.env.EXPO_PUBLIC_POSTHOG_API_KEY = 'ph_test';
  return jest.requireActual<typeof import('./app.config')>('./app.config')
    .default;
}

function renderConfig(appConfig: (context: ConfigContext) => ExpoConfig) {
  return appConfig({
    config: {} as ExpoConfig,
    packageJsonPath: '',
    projectRoot: '',
    staticConfigPath: '',
  } as ConfigContext);
}

describe('Expo app config Android web intent filters', () => {
  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
  });

  it('does not claim blog URLs in Android web intent filters', () => {
    const config = renderConfig(loadAppConfig());
    const webFilters = (config.android?.intentFilters ?? []).filter(
      (filter) => filter.autoVerify
    );
    const data = webFilters.flatMap((filter) =>
      Array.isArray(filter.data)
        ? filter.data
        : filter.data
          ? [filter.data]
          : []
    );
    const nativePaths = [
      { pathPrefix: '/product/' },
      { pathPrefix: '/category/' },
      { path: '/receipts' },
      { pathPrefix: '/receipts/claim/' },
      { path: '/account' },
      { pathPrefix: '/account/' },
      { path: '/cart' },
      { path: '/' },
    ];

    expect(webFilters).toHaveLength(2);
    for (const host of ['ogabassey.com', 'ogabassey.usebaci.com']) {
      const hostData = data.filter((entry) => entry.host === host);

      expect(hostData).toHaveLength(nativePaths.length);
      expect(hostData).toEqual(
        expect.arrayContaining(
          nativePaths.map((path) => expect.objectContaining({ host, ...path }))
        )
      );
      expect(hostData).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ pathPrefix: '/' }),
          expect.objectContaining({ pathPrefix: '/blog/' }),
        ])
      );
    }
  });
});
