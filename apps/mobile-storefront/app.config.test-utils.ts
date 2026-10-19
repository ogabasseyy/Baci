import { jest } from '@jest/globals';
import type { ConfigContext, ExpoConfig } from 'expo/config';

export const originalEnv = process.env;

export function loadAppConfigWithEnv(env: {
  ANDROID_VERSION_CODE?: string;
  EXPO_PUBLIC_HOSTED_STOREFRONT?: string;
  EXPO_PUBLIC_LOCAL_STOREFRONT?: string;
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
  delete process.env.EXPO_PUBLIC_HOSTED_STOREFRONT;
  delete process.env.EXPO_PUBLIC_LOCAL_STOREFRONT;
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

export function renderConfig(
  appConfig: (context: ConfigContext) => ExpoConfig
) {
  return appConfig({
    config: {} as ExpoConfig,
    packageJsonPath: '',
    projectRoot: '',
    staticConfigPath: '',
  } as ConfigContext);
}

export function resetAppConfigEnv() {
  process.env = originalEnv;
  jest.resetModules();
}
