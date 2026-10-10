import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { resolveHostedStagingPushConfig } from '../../../tools/staging/mobile-push/resolve-config.mjs';

const key = 'synthetic-config-regression-key';
const pins = {
  mode: 'hosted-staging',
  apiOrigin: 'https://staging.ogabassey.com',
  supabaseOrigin: 'https://staging-auth.ogabassey.com',
  expectedAuthIssuer: 'https://staging-auth.ogabassey.com/auth/v1',
  merchantId: '10000000-0000-4000-8000-000000000001',
  publicKeySha256: createHash('sha256').update(key).digest('hex'),
  nativeStagingPush: {
    projectId: '22222222-2222-4222-8222-222222222222',
    iosBundleIdentifier: 'com.ogabassey.staging',
    androidPackage: 'com.ogabassey.staging',
    allowedOrigins: [
      'https://staging.ogabassey.com',
      'https://staging-auth.ogabassey.com',
      'https://exp.host',
    ],
  },
};
const environment = {
  NODE_ENV: 'production',
  CI: '1',
  EAS_BUILD: 'true',
  EAS_BUILD_PROFILE: 'hosted-staging-push',
  BACI_REVIEWED_HOSTED_PUSH_BUILD: '1',
  EXPO_PUBLIC_HOSTED_STOREFRONT: '1',
  EXPO_PUBLIC_API_URL: pins.apiOrigin,
  EXPO_PUBLIC_SUPABASE_URL: pins.supabaseOrigin,
  EXPO_PUBLIC_MERCHANT_ID: pins.merchantId,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: key,
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
  EXPO_PUBLIC_POSTHOG_API_KEY: '',
};

test('regression: full EAS staging entry point resolves without production Facebook, PostHog or Sentry', () => {
  const original = { ...environment };
  const config = resolveHostedStagingPushConfig(environment, pins);
  assert.equal(config.extra.eas.projectId, pins.nativeStagingPush.projectId);
  assert.equal(config.extra.posthogApiKey, '');
  assert.equal(config.extra.facebookAppId, '');
  assert.equal(config.updates.enabled, false);
  assert.deepEqual(environment, original);
});

test('full entry point refuses absent native identity and contaminated staging telemetry', () => {
  assert.throws(
    () =>
      resolveHostedStagingPushConfig(environment, {
        ...pins,
        nativeStagingPush: undefined,
      }),
    /native pins/
  );
  assert.throws(
    () =>
      resolveHostedStagingPushConfig(
        { ...environment, EXPO_PUBLIC_SENTRY_DSN: 'never-output' },
        pins
      ),
    /environment/
  );
});

test('staging EAS profile cannot fall through to production when hosted flag or native identity is omitted', () => {
  for (const EXPO_PUBLIC_HOSTED_STOREFRONT of [undefined, '0']) {
    assert.throws(
      () =>
        resolveHostedStagingPushConfig(
          { ...environment, EXPO_PUBLIC_HOSTED_STOREFRONT },
          pins
        ),
      /environment/
    );
  }
  const { nativeStagingPush: omittedIdentity, ...missingPins } = pins;
  assert.ok(omittedIdentity);
  assert.throws(
    () => resolveHostedStagingPushConfig(environment, missingPins),
    /native pins/
  );
});

test('standard production entry point preserves required telemetry validation', () => {
  const production = {
    NODE_ENV: 'test',
    EAS_BUILD: 'true',
    EAS_BUILD_PROFILE: 'production',
  };
  assert.throws(
    () => resolveHostedStagingPushConfig(production, pins),
    /Missing required Facebook/
  );
  const facebook = {
    ...production,
    STOREFRONT_FACEBOOK_APP_ID: 'test-id',
    STOREFRONT_FACEBOOK_CLIENT_TOKEN: 'test-token',
  };
  assert.throws(
    () => resolveHostedStagingPushConfig(facebook, pins),
    /Missing required PostHog/
  );
  assert.throws(
    () =>
      resolveHostedStagingPushConfig(
        { ...facebook, EXPO_PUBLIC_POSTHOG_API_KEY: 'test-key' },
        pins
      ),
    /Missing required Sentry/
  );
});

test('regression: an explicit staging profile cannot select production when the EAS marker is missing', () => {
  for (const EAS_BUILD of [undefined, '', 'false', '1']) {
    assert.throws(
      () =>
        resolveHostedStagingPushConfig(
          {
            ...environment,
            EAS_BUILD,
            EXPO_PUBLIC_HOSTED_STOREFRONT: undefined,
          },
          pins
        ),
      /reviewed EAS profile/
    );
  }
});

test('production resolved identity and updates remain the production configuration', () => {
  const config = resolveHostedStagingPushConfig(
    {
      NODE_ENV: 'test',
      STOREFRONT_FACEBOOK_APP_ID: 'test-id',
      STOREFRONT_FACEBOOK_CLIENT_TOKEN: 'test-token',
      EXPO_PUBLIC_POSTHOG_API_KEY: 'test-key',
    },
    pins
  );
  assert.equal(
    config.extra.eas.projectId,
    'c6c1897b-cac8-49b0-85f9-3d277aecc379'
  );
  assert.equal(config.ios.bundleIdentifier, 'com.ogabassey.app');
  assert.equal(config.android.package, 'com.ogabassey.store');
  assert.equal(
    config.updates.url,
    'https://u.expo.dev/c6c1897b-cac8-49b0-85f9-3d277aecc379'
  );
});
