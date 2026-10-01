import path from 'node:path';

if (process.env.NODE_ENV !== 'test') {
  require('dotenv').config({
    path: path.resolve(__dirname, '.env'),
    quiet: true,
  });
}

import type { TikTokBusinessPlugin } from '@baci/tiktok-business';
import type { ConfigContext, ExpoConfig } from 'expo/config';

const { createExpoPlugins } =
  require('./config/expo-plugins.js') as typeof import('./config/expo-plugins');
const { buildStorefrontAndroidIntentFilters } =
  require('./config/android-intent-filters.js') as typeof import('./config/android-intent-filters');
const { resolveUpdateChannel } =
  require('./config/resolve-update-channel.js') as typeof import('./config/resolve-update-channel');
const { buildSentryExpoConfiguration } =
  require('./config/sentry-expo-config') as typeof import('./config/sentry-expo-config');
const { isSentryConfigurationRequired } =
  require('./config/sentry-required-environment') as typeof import('./config/sentry-required-environment');
const {
  DEFAULT_STOREFRONT_TIKTOK_IOS_APP_STORE_ID,
  DEFAULT_STOREFRONT_TIKTOK_IOS_TIKTOK_APP_ID,
} = require('./config/tiktok-constants') as {
  DEFAULT_STOREFRONT_TIKTOK_IOS_APP_STORE_ID: string;
  DEFAULT_STOREFRONT_TIKTOK_IOS_TIKTOK_APP_ID: string;
};

const rawAndroidVersionCode = process.env.ANDROID_VERSION_CODE;
const parsedAndroidVersionCode =
  rawAndroidVersionCode === undefined
    ? undefined
    : Number(rawAndroidVersionCode);
let androidVersionCode: number | undefined;
const appVersion = '2.0.1';
const androidRuntimeVersion = `${appVersion}-android-sdk57-rn0862`;
const DEFAULT_ANDROID_VERSION_CODE = 741;

// `parsedAndroidVersionCode` is undefined iff `rawAndroidVersionCode` is, so
// checking only the parsed value is sufficient and narrows the type below.
if (parsedAndroidVersionCode !== undefined) {
  if (!Number.isInteger(parsedAndroidVersionCode)) {
    console.warn(
      `[app.config] Ignoring ANDROID_VERSION_CODE="${rawAndroidVersionCode}" because it is not an integer.`
    );
  } else if (parsedAndroidVersionCode <= 0) {
    console.warn(
      `[app.config] Ignoring ANDROID_VERSION_CODE="${rawAndroidVersionCode}" because it must be greater than 0.`
    );
  } else if (parsedAndroidVersionCode > 2_100_000_000) {
    console.warn(
      `[app.config] Ignoring ANDROID_VERSION_CODE="${rawAndroidVersionCode}" because it exceeds 2100000000.`
    );
  } else {
    androidVersionCode = parsedAndroidVersionCode;
  }
}

const rawIosBuildNumber = process.env.IOS_BUILD_NUMBER;
let iosBuildNumber: string | undefined;

if (rawIosBuildNumber !== undefined) {
  const parsed = Number(rawIosBuildNumber);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.warn(
      `[app.config] Ignoring IOS_BUILD_NUMBER="${rawIosBuildNumber}" because it must be a positive integer.`
    );
  } else {
    iosBuildNumber = String(parsed);
  }
}

const rawIosAppVersion = process.env.IOS_APP_VERSION;
let _iosAppVersion: string | undefined;

if (rawIosAppVersion !== undefined && rawIosAppVersion.trim().length > 0) {
  const trimmed = rawIosAppVersion.trim();
  if (!/^\d+\.\d+\.\d+$/.test(trimmed)) {
    throw new Error(
      `[app.config] Invalid IOS_APP_VERSION="${rawIosAppVersion}". Must be semantic version major.minor.patch (e.g., 2.1.31).`
    );
  }
  _iosAppVersion = trimmed;
}

const runtimeVersion = _iosAppVersion ?? appVersion;
const tiktokIosAppStoreId =
  process.env.STOREFRONT_TIKTOK_APP_STORE_ID?.trim() ||
  DEFAULT_STOREFRONT_TIKTOK_IOS_APP_STORE_ID;
const tiktokIosAppId =
  process.env.STOREFRONT_TIKTOK_APP_ID?.trim() ||
  DEFAULT_STOREFRONT_TIKTOK_IOS_TIKTOK_APP_ID;
const tiktokIosAppSecret =
  process.env.STOREFRONT_TIKTOK_APP_SECRET?.trim() || undefined;
const isTikTokBusinessConfigured = Boolean(
  tiktokIosAppStoreId && tiktokIosAppId && tiktokIosAppSecret
);
const tiktokBusinessPlugin: TikTokBusinessPlugin | null =
  isTikTokBusinessConfigured && tiktokIosAppSecret
    ? [
        '@baci/tiktok-business/plugin',
        {
          ios: {
            appId: tiktokIosAppStoreId,
            tiktokAppId: tiktokIosAppId,
            appSecret: tiktokIosAppSecret,
            autoInitialize: false,
            debugMode: process.env.TIKTOK_SDK_DEBUG === '1',
            disableSKAdNetworkSupport:
              process.env.STOREFRONT_TIKTOK_DISABLE_SKAN === '1',
          },
        },
      ]
    : null;

const facebookAppId = process.env.STOREFRONT_FACEBOOK_APP_ID?.trim();
const facebookClientToken =
  process.env.STOREFRONT_FACEBOOK_CLIENT_TOKEN?.trim();
const posthogApiKey = process.env.EXPO_PUBLIC_POSTHOG_API_KEY?.trim();
const posthogHost =
  process.env.EXPO_PUBLIC_POSTHOG_HOST?.trim() || 'https://eu.i.posthog.com';
const merchantDomain =
  process.env.EXPO_PUBLIC_MERCHANT_DOMAIN?.trim() || 'ogabassey.com';
const updateChannel = resolveUpdateChannel(process.env);

const isContinuousIntegration =
  process.env.CI === 'true' || process.env.CI === '1';
const isRequiredEnv =
  isContinuousIntegration ||
  process.env.EAS_BUILD === 'true' ||
  process.env.NODE_ENV === 'production' ||
  process.env.NODE_ENV === 'test';
const isSentryRequiredEnv = isSentryConfigurationRequired(process.env);

if (!facebookAppId || !facebookClientToken) {
  if (isRequiredEnv) {
    const missingFacebookCredentials = [];
    if (!facebookAppId) {
      missingFacebookCredentials.push('STOREFRONT_FACEBOOK_APP_ID');
    }
    if (!facebookClientToken) {
      missingFacebookCredentials.push('STOREFRONT_FACEBOOK_CLIENT_TOKEN');
    }

    throw new Error(
      `[app.config] Missing required Facebook credentials: ${missingFacebookCredentials.join(', ')}. Both STOREFRONT_FACEBOOK_APP_ID and STOREFRONT_FACEBOOK_CLIENT_TOKEN must be set in CI/EAS/production/test environments.`
    );
  } else {
    console.warn(
      '[app.config] WARNING: STOREFRONT_FACEBOOK_APP_ID or STOREFRONT_FACEBOOK_CLIENT_TOKEN is missing. Facebook SDK plugin will be disabled for local development.'
    );
  }
}

if (!posthogApiKey) {
  if (isRequiredEnv) {
    throw new Error(
      '[app.config] Missing required PostHog key: EXPO_PUBLIC_POSTHOG_API_KEY. Set it in CI/EAS/production/test environments so mobile storefront crash logging is enabled.'
    );
  } else {
    console.warn(
      '[app.config] WARNING: EXPO_PUBLIC_POSTHOG_API_KEY is missing. PostHog crash logging will be disabled for local development.'
    );
  }
}

const isFacebookSdkConfigured = Boolean(facebookAppId && facebookClientToken);

const facebookSdkPlugin: NonNullable<ExpoConfig['plugins']>[number] | null =
  isFacebookSdkConfigured && facebookAppId && facebookClientToken
    ? [
        'react-native-fbsdk-next',
        {
          appID: facebookAppId,
          clientToken: facebookClientToken,
          displayName: 'Ogabassey',
          scheme: `fb${facebookAppId}`,
          advertiserIDCollectionEnabled: false,
          autoLogAppEventsEnabled: false,
        },
      ]
    : null;

const { plugin: sentryPlugin } = buildSentryExpoConfiguration(process.env, {
  required: isSentryRequiredEnv,
});

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Ogabassey',
  slug: 'ogabassey-store',
  owner: 'ogabassey',
  version: runtimeVersion,
  orientation: 'default',
  icon: './assets/images/icon.png',
  userInterfaceStyle: 'automatic',
  scheme: 'ogabassey',
  assetBundlePatterns: ['**/*'],
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.ogabassey.app',
    buildNumber: iosBuildNumber ?? '9',
    associatedDomains: [
      'applinks:ogabassey.com',
      'applinks:ogabassey.usebaci.com',
    ],
    googleServicesFile: './GoogleService-Info.plist',
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSUserTrackingUsageDescription:
        'We use your activity to measure advertising performance and show more relevant offers across apps and websites.',
      SKAdNetworkItems: [
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
      ],
    },
  },
  android: {
    runtimeVersion: androidRuntimeVersion,
    versionCode: androidVersionCode ?? DEFAULT_ANDROID_VERSION_CODE,
    package: 'com.ogabassey.store',
    googleServicesFile: './google-services.json',
    adaptiveIcon: {
      foregroundImage: './assets/images/adaptive-icon.png',
      backgroundColor: '#000000',
    },
    intentFilters: [
      {
        action: 'VIEW',
        data: [
          {
            scheme: 'ogabassey',
          },
        ],
        category: ['BROWSABLE', 'DEFAULT'],
      },
      ...buildStorefrontAndroidIntentFilters(),
    ],
  },
  plugins: createExpoPlugins({
    facebookSdkPlugin,
    sentryPlugin,
    tiktokBusinessPlugin,
  }),
  web: {
    bundler: 'metro',
    output: 'static',
    favicon: './assets/images/favicon.png',
  },
  experiments: {
    typedRoutes: true,
  },
  extra: {
    merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
    merchantSlug: 'ogabassey',
    merchantDomain,
    businessType: 'electronics',
    templateId: 'default',
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabasePublishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    apiUrl: process.env.EXPO_PUBLIC_API_URL,
    posthogApiKey,
    posthogHost,
    tiktokBusiness: {
      iosAppStoreId: tiktokIosAppStoreId,
      iosTikTokAppId: tiktokIosAppId,
      isConfigured: isTikTokBusinessConfigured,
    },
    facebookAppId: facebookAppId ?? null,
    facebookClientToken: facebookClientToken ?? null,
    eas: {
      projectId: 'c6c1897b-cac8-49b0-85f9-3d277aecc379',
    },
  },
  updates: {
    url: 'https://u.expo.dev/c6c1897b-cac8-49b0-85f9-3d277aecc379',
    checkAutomatically: 'ON_ERROR_RECOVERY',
    fallbackToCacheTimeout: 0,
    requestHeaders: {
      'expo-channel-name': updateChannel,
    },
  },
  runtimeVersion,
});
