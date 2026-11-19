import NetInfo from '@react-native-community/netinfo';
import type { ExpoConfig } from 'expo/config';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { buildOxygenStagingExpoConfig } from '../config/oxygen-staging-expo-config';
import { installOxygenStagingRuntime } from './install-oxygen-staging-runtime';
import { oxygenStagingManifestEqual } from './oxygen-staging-manifest-equal';
import { readOxygenStagingProfile } from './oxygen-staging-profile';

export function startOxygenStagingRuntime(): void {
  const development = typeof __DEV__ !== 'undefined' && __DEV__;
  // Keep references static so Expo substitutes the reviewed build pins.
  const expected = buildOxygenStagingExpoConfig({
    NODE_ENV: development ? 'development' : 'production',
    EXPO_PUBLIC_OXYGEN_STAGING: process.env.EXPO_PUBLIC_OXYGEN_STAGING,
    EXPO_PUBLIC_OXYGEN_API_ORIGIN: process.env.EXPO_PUBLIC_OXYGEN_API_ORIGIN,
    EXPO_PUBLIC_OXYGEN_AUTH_ORIGIN: process.env.EXPO_PUBLIC_OXYGEN_AUTH_ORIGIN,
    EXPO_PUBLIC_OXYGEN_AUTH_BASE_URL:
      process.env.EXPO_PUBLIC_OXYGEN_AUTH_BASE_URL,
    EXPO_PUBLIC_OXYGEN_AUTH_ISSUER: process.env.EXPO_PUBLIC_OXYGEN_AUTH_ISSUER,
    EXPO_PUBLIC_OXYGEN_PUBLIC_KEY: process.env.EXPO_PUBLIC_OXYGEN_PUBLIC_KEY,
    EXPO_PUBLIC_OXYGEN_MERCHANT_ID: process.env.EXPO_PUBLIC_OXYGEN_MERCHANT_ID,
    EXPO_PUBLIC_OXYGEN_MERCHANT_SLUG:
      process.env.EXPO_PUBLIC_OXYGEN_MERCHANT_SLUG,
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    EXPO_PUBLIC_MERCHANT_ID: process.env.EXPO_PUBLIC_MERCHANT_ID,
    EXPO_PUBLIC_LOCAL_STOREFRONT: process.env.EXPO_PUBLIC_LOCAL_STOREFRONT,
    EXPO_PUBLIC_HOSTED_STOREFRONT: process.env.EXPO_PUBLIC_HOSTED_STOREFRONT,
    EXPO_PUBLIC_PHONE_QA: process.env.EXPO_PUBLIC_PHONE_QA,
    EXPO_PUBLIC_SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN,
    EXPO_PUBLIC_QUIZ_ADS_ENABLED: process.env.EXPO_PUBLIC_QUIZ_ADS_ENABLED,
    EXPO_PUBLIC_POSTHOG_API_KEY: process.env.EXPO_PUBLIC_POSTHOG_API_KEY,
    EXPO_PUBLIC_FACEBOOK_APP_ID: process.env.EXPO_PUBLIC_FACEBOOK_APP_ID,
    EXPO_PUBLIC_FACEBOOK_CLIENT_TOKEN:
      process.env.EXPO_PUBLIC_FACEBOOK_CLIENT_TOKEN,
    EXPO_PUBLIC_TIKTOK_APP_ID: process.env.EXPO_PUBLIC_TIKTOK_APP_ID,
  });
  installOxygenStagingBuild(expected, development);
}

export function installOxygenStagingBuild(
  expected: ExpoConfig | null,
  development: boolean
): void {
  const manifest = Constants.expoConfig;
  if (
    !expected ||
    !manifest ||
    manifest.updates?.enabled !== false ||
    Application.applicationId !== 'com.ogabassey.oxygenstaging' ||
    manifest.ios?.bundleIdentifier !== expected.ios?.bundleIdentifier ||
    manifest.android?.package !== expected.android?.package ||
    manifest.scheme !== expected.scheme ||
    // Includes the order service's merchantId, generated from this profile.
    Object.entries(expected.extra ?? {}).some(
      ([key, value]) =>
        !oxygenStagingManifestEqual(manifest.extra?.[key], value)
    )
  )
    throw new Error(
      'Oxygen staging requires a fresh isolated development build'
    );
  const profile = readOxygenStagingProfile(
    expected.extra?.oxygenStaging,
    development
  );
  installOxygenStagingRuntime(profile);
  NetInfo.configure({
    reachabilityUrl: `${profile.apiOrigin}/api/csrf`,
    reachabilityMethod: 'GET',
    reachabilityTest: async (response) => response.ok,
    useNativeReachability: false,
  });
}
