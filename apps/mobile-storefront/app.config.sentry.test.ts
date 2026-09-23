import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { ConfigContext, ExpoConfig } from 'expo/config';

const originalEnv = process.env;

function renderAppConfig(sentryEnv: Record<string, string | undefined>) {
  jest.resetModules();
  process.env = {
    ...originalEnv,
    NODE_ENV: 'test',
    EXPO_PUBLIC_POSTHOG_API_KEY: 'ph_test',
    STOREFRONT_FACEBOOK_APP_ID: '123456789',
    STOREFRONT_FACEBOOK_CLIENT_TOKEN: 'client-token',
  };
  for (const key of [
    'EXPO_PUBLIC_SENTRY_DSN',
    'EXPO_PUBLIC_SENTRY_ENVIRONMENT',
    'SENTRY_AUTH_TOKEN',
    'SENTRY_ORG',
    'SENTRY_PROJECT',
  ]) {
    delete process.env[key];
  }
  Object.assign(process.env, sentryEnv);

  const appConfig =
    jest.requireActual<typeof import('./app.config')>('./app.config').default;
  return appConfig({ config: {} as ExpoConfig } as ConfigContext);
}

describe('Expo app config Sentry integration', () => {
  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
  });

  it('adds the native Sentry plugin to the final Expo plugin list', () => {
    const config = renderAppConfig({
      EXPO_PUBLIC_SENTRY_DSN: 'https://public@example.ingest.sentry.io/1',
      SENTRY_AUTH_TOKEN: 'build-token',
      SENTRY_ORG: 'ogabassey',
      SENTRY_PROJECT: 'storefront',
    });

    expect(config.plugins).toContainEqual([
      '@sentry/react-native/expo',
      expect.objectContaining({
        organization: 'ogabassey',
        project: 'storefront',
        useNativeInit: true,
      }),
    ]);
  });

  it('enables native capture without upload credentials for local development', () => {
    const config = renderAppConfig({
      EXPO_PUBLIC_SENTRY_DSN: 'https://public@example.ingest.sentry.io/1',
    });

    expect(config.plugins).toContainEqual([
      '@sentry/react-native/expo',
      expect.objectContaining({
        disableAutoUpload: true,
        useNativeInit: true,
        options: expect.objectContaining({ environment: 'development' }),
      }),
    ]);
  });
});
