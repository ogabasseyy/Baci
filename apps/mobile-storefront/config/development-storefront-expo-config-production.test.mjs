import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveHostedStagingPushConfig } from '../../../tools/staging/mobile-push/resolve-config.mjs';

test('production EAS still requires all Sentry upload credentials after staging extraction', () => {
  const environment = {
    NODE_ENV: 'test',
    EAS_BUILD: 'true',
    EAS_BUILD_PROFILE: 'production',
    STOREFRONT_FACEBOOK_APP_ID: 'synthetic-id',
    STOREFRONT_FACEBOOK_CLIENT_TOKEN: 'synthetic-token',
    EXPO_PUBLIC_POSTHOG_API_KEY: 'synthetic-key',
    EXPO_PUBLIC_SENTRY_DSN: 'https://synthetic.example/1',
    SENTRY_ORG: 'synthetic-org',
    SENTRY_PROJECT: 'synthetic-project',
    SENTRY_AUTH_TOKEN: 'synthetic-upload-token',
  };
  const config = resolveHostedStagingPushConfig(environment, {});
  assert.ok(
    config.plugins.some(
      (plugin) =>
        Array.isArray(plugin) && plugin[0] === '@sentry/react-native/expo'
    )
  );
  for (const field of [
    'EXPO_PUBLIC_SENTRY_DSN',
    'SENTRY_ORG',
    'SENTRY_PROJECT',
    'SENTRY_AUTH_TOKEN',
  ]) {
    assert.throws(
      () =>
        resolveHostedStagingPushConfig(
          { ...environment, [field]: undefined },
          {}
        ),
      /Missing required Sentry/
    );
  }
});

test('production dotenv and asset paths remain rooted at the app after factory extraction', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const dotenvPaths = [];
  const config = resolveHostedStagingPushConfig(
    {
      NODE_ENV: 'development',
      STOREFRONT_FACEBOOK_APP_ID: 'synthetic-id',
      STOREFRONT_FACEBOOK_CLIENT_TOKEN: 'synthetic-token',
      EXPO_PUBLIC_POSTHOG_API_KEY: 'synthetic-key',
    },
    {},
    (path) => dotenvPaths.push(path)
  );
  assert.deepEqual(dotenvPaths, [resolve(root, '.env')]);
  for (const asset of [
    config.icon,
    config.android.adaptiveIcon.foregroundImage,
    config.web.favicon,
  ]) {
    assert.ok(existsSync(resolve(root, asset)));
  }
  assert.equal(config.ios.googleServicesFile, './GoogleService-Info.plist');
  assert.equal(config.android.googleServicesFile, './google-services.json');
});
