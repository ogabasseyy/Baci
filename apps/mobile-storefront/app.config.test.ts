import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { ConfigContext, ExpoConfig } from 'expo/config';

// Keep app-config tests hermetic by preventing dotenv from loading local .env.
jest.mock('dotenv/config', () => ({}));

const originalEnv = process.env;

function loadAppConfigWithEnv(env: {
  ANDROID_VERSION_CODE?: string;
  EXPO_PUBLIC_MERCHANT_DOMAIN?: string;
  EXPO_PUBLIC_POSTHOG_API_KEY?: string;
  EXPO_PUBLIC_POSTHOG_HOST?: string;
  EXPO_PUBLIC_SUPABASE_ANON_KEY?: string;
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  EXPO_PUBLIC_SUPABASE_URL?: string;
  EXPO_UPDATE_CHANNEL?: string;
  STOREFRONT_FACEBOOK_APP_ID?: string;
  STOREFRONT_FACEBOOK_CLIENT_TOKEN?: string;
}) {
  jest.resetModules();
  process.env = { ...originalEnv };
  delete process.env.ANDROID_VERSION_CODE;
  delete process.env.EXPO_PUBLIC_MERCHANT_DOMAIN;
  delete process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
  delete process.env.EXPO_PUBLIC_POSTHOG_HOST;
  delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  delete process.env.EXPO_UPDATE_CHANNEL;
  delete process.env.STOREFRONT_FACEBOOK_APP_ID;
  delete process.env.STOREFRONT_FACEBOOK_CLIENT_TOKEN;
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
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

function findFacebookPlugin(config: ExpoConfig) {
  return config.plugins?.find(
    (plugin): plugin is [string, Record<string, unknown>] =>
      Array.isArray(plugin) && plugin[0] === 'react-native-fbsdk-next'
  );
}

function findPostHogPlugin(config: ExpoConfig) {
  return config.plugins?.find(
    (plugin): plugin is [string, Record<string, unknown>] =>
      Array.isArray(plugin) && plugin[0] === 'posthog-react-native/expo'
  );
}

describe('Expo app config (Facebook SDK and merchant domain)', () => {
  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
  });

  it('fails fast when both Facebook SDK credentials are absent from the environment', () => {
    expect(() => {
      const appConfig = loadAppConfigWithEnv({});
      renderConfig(appConfig);
    }).toThrow(
      /Missing required Facebook credentials: STOREFRONT_FACEBOOK_APP_ID, STOREFRONT_FACEBOOK_CLIENT_TOKEN\./
    );
  });

  it('injects the Facebook SDK plugin when both credentials are configured', () => {
    const appConfig = loadAppConfigWithEnv({
      EXPO_PUBLIC_POSTHOG_API_KEY: 'ph_test',
      STOREFRONT_FACEBOOK_APP_ID: '123456789',
      STOREFRONT_FACEBOOK_CLIENT_TOKEN: 'client-token',
    });
    const config = renderConfig(appConfig);
    expect(findFacebookPlugin(config)).toEqual([
      'react-native-fbsdk-next',
      {
        advertiserIDCollectionEnabled: false,
        appID: '123456789',
        autoLogAppEventsEnabled: false,
        clientToken: 'client-token',
        displayName: 'Ogabassey',
        scheme: 'fb123456789',
      },
    ]);
    expect(config.extra?.facebookAppId).toBe('123456789');
    expect(config.extra?.facebookClientToken).toBe('client-token');
  });

  it('embeds the EAS update channel request header from EXPO_UPDATE_CHANNEL', () => {
    const appConfig = loadAppConfigWithEnv({
      EXPO_PUBLIC_POSTHOG_API_KEY: 'ph_test',
      EXPO_UPDATE_CHANNEL: 'preview',
      STOREFRONT_FACEBOOK_APP_ID: '123456789',
      STOREFRONT_FACEBOOK_CLIENT_TOKEN: 'client-token',
    });
    const config = renderConfig(appConfig);
    expect(config.updates).toMatchObject({
      requestHeaders: {
        'expo-channel-name': 'preview',
      },
      url: 'https://u.expo.dev/c6c1897b-cac8-49b0-85f9-3d277aecc379',
    });
    expect(config.runtimeVersion).toBeTruthy();
  });

  it('uses an Android-specific runtime boundary for the SDK 57 native upgrade', () => {
    const appConfig = loadAppConfigWithEnv({
      EXPO_PUBLIC_POSTHOG_API_KEY: 'ph_test',
      STOREFRONT_FACEBOOK_APP_ID: '123456789',
      STOREFRONT_FACEBOOK_CLIENT_TOKEN: 'client-token',
    });
    const config = renderConfig(appConfig);
    expect(config.version).toBe('2.0.1');
    expect(config.runtimeVersion).toBe('2.0.1');
    expect(config.android).toMatchObject({
      runtimeVersion: '2.0.1-android-sdk57-rn0862',
      versionCode: 741,
    });
  });

  it('defaults the storefront merchant domain for production BNPL returns', () => {
    const appConfig = loadAppConfigWithEnv({
      EXPO_PUBLIC_POSTHOG_API_KEY: 'ph_test',
      STOREFRONT_FACEBOOK_APP_ID: '123456789',
      STOREFRONT_FACEBOOK_CLIENT_TOKEN: 'client-token',
    });
    const config = renderConfig(appConfig);

    expect(config.extra?.merchantDomain).toBe('ogabassey.com');
  });

  it('trims the configured storefront merchant domain', () => {
    const appConfig = loadAppConfigWithEnv({
      EXPO_PUBLIC_POSTHOG_API_KEY: 'ph_test',
      EXPO_PUBLIC_MERCHANT_DOMAIN: '  shop.example.com  ',
      STOREFRONT_FACEBOOK_APP_ID: '123456789',
      STOREFRONT_FACEBOOK_CLIENT_TOKEN: 'client-token',
    });
    const config = renderConfig(appConfig);

    expect(config.extra?.merchantDomain).toBe('shop.example.com');
  });

  it.each([
    '',
    '   ',
  ])('falls back to the default merchant domain when the configured value is %p', (merchantDomain) => {
    const appConfig = loadAppConfigWithEnv({
      EXPO_PUBLIC_POSTHOG_API_KEY: 'ph_test',
      EXPO_PUBLIC_MERCHANT_DOMAIN: merchantDomain,
      STOREFRONT_FACEBOOK_APP_ID: '123456789',
      STOREFRONT_FACEBOOK_CLIENT_TOKEN: 'client-token',
    });
    const config = renderConfig(appConfig);

    expect(config.extra?.merchantDomain).toBe('ogabassey.com');
  });

  it('fails fast when Facebook SDK credentials are only partially configured', () => {
    expect(() =>
      loadAppConfigWithEnv({
        EXPO_PUBLIC_POSTHOG_API_KEY: 'ph_test',
        STOREFRONT_FACEBOOK_APP_ID: '123456789',
      })
    ).toThrow(
      /Missing required Facebook credentials: STOREFRONT_FACEBOOK_CLIENT_TOKEN\./
    );

    expect(() =>
      loadAppConfigWithEnv({
        EXPO_PUBLIC_POSTHOG_API_KEY: 'ph_test',
        STOREFRONT_FACEBOOK_CLIENT_TOKEN: 'client-token',
      })
    ).toThrow(
      /Missing required Facebook credentials: STOREFRONT_FACEBOOK_APP_ID\./
    );
  });

  it('fails fast when the PostHog API key is absent from release-like environments', () => {
    expect(() =>
      loadAppConfigWithEnv({
        STOREFRONT_FACEBOOK_APP_ID: '123456789',
        STOREFRONT_FACEBOOK_CLIENT_TOKEN: 'client-token',
      })
    ).toThrow(/Missing required PostHog key: EXPO_PUBLIC_POSTHOG_API_KEY\./);
  });

  it('defaults PostHog to the EU ingest host and trims configured values', () => {
    const defaultHostConfig = renderConfig(
      loadAppConfigWithEnv({
        EXPO_PUBLIC_POSTHOG_API_KEY: ' ph_test ',
        STOREFRONT_FACEBOOK_APP_ID: '123456789',
        STOREFRONT_FACEBOOK_CLIENT_TOKEN: 'client-token',
      })
    );

    expect(defaultHostConfig.extra?.posthogApiKey).toBe('ph_test');
    expect(defaultHostConfig.extra?.posthogHost).toBe(
      'https://eu.i.posthog.com'
    );

    const customHostConfig = renderConfig(
      loadAppConfigWithEnv({
        EXPO_PUBLIC_POSTHOG_API_KEY: 'ph_test',
        EXPO_PUBLIC_POSTHOG_HOST: ' https://posthog.example.com ',
        STOREFRONT_FACEBOOK_APP_ID: '123456789',
        STOREFRONT_FACEBOOK_CLIENT_TOKEN: 'client-token',
      })
    );

    expect(customHostConfig.extra?.posthogHost).toBe(
      'https://posthog.example.com'
    );
  });

  it('enables the PostHog Expo plugin with native symbol uploads', () => {
    const appConfig = loadAppConfigWithEnv({
      EXPO_PUBLIC_POSTHOG_API_KEY: 'ph_test',
      STOREFRONT_FACEBOOK_APP_ID: '123456789',
      STOREFRONT_FACEBOOK_CLIENT_TOKEN: 'client-token',
    });
    const config = renderConfig(appConfig);

    expect(findPostHogPlugin(config)).toEqual([
      'posthog-react-native/expo',
      {
        uploadNativeSymbols: true,
      },
    ]);
  });

  it('runs the durable PostHog Xcode CLI path plugin after the stock plugin', () => {
    const appConfig = loadAppConfigWithEnv({
      EXPO_PUBLIC_POSTHOG_API_KEY: 'ph_test',
      STOREFRONT_FACEBOOK_APP_ID: '123456789',
      STOREFRONT_FACEBOOK_CLIENT_TOKEN: 'client-token',
    });
    const config = renderConfig(appConfig);
    const plugins = config.plugins ?? [];
    const posthogIndex = plugins.findIndex(
      (plugin) =>
        Array.isArray(plugin) && plugin[0] === 'posthog-react-native/expo'
    );
    const xcodeCliPathIndex = plugins.indexOf(
      './config/withPostHogXcodeCliPath.js'
    );

    expect(posthogIndex).toBeGreaterThan(-1);
    expect(xcodeCliPathIndex).toBeGreaterThan(posthogIndex);
  });

  it('declares SKAdNetwork identifiers for TikTok and Facebook campaign attribution', () => {
    const appConfig = loadAppConfigWithEnv({
      EXPO_PUBLIC_POSTHOG_API_KEY: 'ph_test',
      STOREFRONT_FACEBOOK_APP_ID: '123456789',
      STOREFRONT_FACEBOOK_CLIENT_TOKEN: 'client-token',
    });
    const config = renderConfig(appConfig);

    expect(config.ios?.infoPlist?.SKAdNetworkItems).toEqual([
      {
        SKAdNetworkIdentifier: 'ce2y4j37ch.skadnetwork',
      },
      {
        SKAdNetworkIdentifier: '282ce24gcd.skadnetwork',
      },
      {
        SKAdNetworkIdentifier: 'v9wttpbfk9.skadnetwork',
      },
      {
        SKAdNetworkIdentifier: 'n38lu8286q.skadnetwork',
      },
    ]);
  });

  it('allows Android to adapt orientation and resizability on large screens', () => {
    const appConfig = loadAppConfigWithEnv({
      EXPO_PUBLIC_POSTHOG_API_KEY: 'ph_test',
      STOREFRONT_FACEBOOK_APP_ID: '123456789',
      STOREFRONT_FACEBOOK_CLIENT_TOKEN: 'client-token',
    });
    const config = renderConfig(appConfig);

    expect(config.orientation).toBe('default');
    expect(config.plugins).toContain('./config/withAdaptiveAndroidManifest.js');
  });
});
