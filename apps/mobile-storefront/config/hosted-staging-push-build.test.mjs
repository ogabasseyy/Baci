import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const key = 'synthetic-staging-public-key';
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
  EAS_BUILD: 'true',
  EAS_BUILD_PROFILE: 'hosted-staging-push',
  BACI_REVIEWED_HOSTED_PUSH_BUILD: '1',
  CI: '1',
  NODE_ENV: 'production',
  EXPO_PUBLIC_HOSTED_STOREFRONT: '1',
  EXPO_PUBLIC_API_URL: pins.apiOrigin,
  EXPO_PUBLIC_SUPABASE_URL: pins.supabaseOrigin,
  EXPO_PUBLIC_MERCHANT_ID: pins.merchantId,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: key,
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
  EXPO_PUBLIC_POSTHOG_API_KEY: '',
};

function prepare(input = environment, profile = pins) {
  return require('./hosted-staging-push-build').prepareHostedStagingPushBuild(
    input,
    profile
  );
}

function loadBuilder(profile = pins) {
  const module = { exports: {} };
  vm.runInNewContext(
    readFileSync(
      new URL('./development-storefront-expo-config.js', import.meta.url),
      'utf8'
    ),
    {
      module,
      require(name) {
        if (name === './hosted-storefront-pins.json') return profile;
        if (name === './local-storefront-expo-config')
          return { buildLocalStorefrontExpoConfig: () => null };
        return require(name);
      },
    }
  );
  return module.exports.buildDevelopmentStorefrontExpoConfig;
}

test('regression: only reviewed exact EAS profile passes the isolated launch guard', () => {
  const config = loadBuilder()(environment);
  assert.equal(
    config.ios.bundleIdentifier,
    pins.nativeStagingPush.iosBundleIdentifier
  );
  assert.equal(config.android.package, pins.nativeStagingPush.androidPackage);
  assert.equal(config.extra.eas.projectId, pins.nativeStagingPush.projectId);
  assert.equal(config.extra.hostedStorefront, true);
  assert.equal(config.extra.posthogApiKey, '');
  assert.equal(config.extra.facebookAppId, '');
  assert.equal(config.extra.tiktokBusiness.isConfigured, false);
  assert.equal(config.updates.enabled, false);
  assert.ok(
    config.plugins.some(
      (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-notifications'
    )
  );
});

test('normalizes a copy only after review and leaves the caller environment intact', () => {
  const original = Object.freeze({ ...environment });
  const normalized = prepare(original);
  assert.equal(normalized.NODE_ENV, 'development');
  assert.equal(normalized.EAS_BUILD, undefined);
  assert.equal(normalized.CI, undefined);
  assert.equal(normalized.EAS_BUILD_PROFILE, 'hosted-staging-push');
  assert.throws(() => loadBuilder()(normalized), /reviewed EAS profile/);
  assert.equal(original.EAS_BUILD, 'true');
  assert.equal(original.NODE_ENV, 'production');
  assert.equal(normalized.EXPO_PUBLIC_API_URL, pins.apiOrigin);
});

test('rejects missing or wrong cloud/profile/review markers, not generic CI permission', () => {
  for (const override of [
    { EAS_BUILD: undefined },
    { EAS_BUILD: 'false' },
    { EAS_BUILD: '1' },
    { EAS_BUILD_PROFILE: undefined },
    { EAS_BUILD_PROFILE: 'production' },
    { EAS_BUILD_PROFILE: 'development' },
    { EAS_BUILD_PROFILE: 'HOSTED-STAGING-PUSH' },
    { BACI_REVIEWED_HOSTED_PUSH_BUILD: undefined },
    { BACI_REVIEWED_HOSTED_PUSH_BUILD: 'true' },
  ])
    assert.throws(
      () => prepare({ ...environment, ...override }),
      /reviewed EAS profile/
    );
});

test('regression: missing native pins cannot produce a cloud production-identity fallback', () => {
  for (const missing of [undefined, null, {}, []]) {
    const profile = { ...pins, nativeStagingPush: missing };
    assert.throws(() => prepare(environment, profile), /native pins/);
    assert.throws(() => loadBuilder(profile)(environment), /native pins/);
  }
});

test('rejects production project identifiers regardless of casing', () => {
  for (const projectId of [
    'c6c1897b-cac8-49b0-85f9-3d277aecc379',
    'C6C1897B-CAC8-49B0-85F9-3D277AECC379',
  ])
    assert.throws(
      () =>
        prepare(environment, {
          ...pins,
          nativeStagingPush: { ...pins.nativeStagingPush, projectId },
        }),
      /native pins/
    );
});

test('rejects both production native identities in either platform field', () => {
  for (const field of ['iosBundleIdentifier', 'androidPackage']) {
    for (const value of [
      'com.ogabassey.app',
      'com.ogabassey.store',
      'COM.OGABASSEY.APP',
    ]) {
      assert.throws(
        () =>
          prepare(environment, {
            ...pins,
            nativeStagingPush: { ...pins.nativeStagingPush, [field]: value },
          }),
        /native pins/
      );
    }
  }
});

test('rejects invalid identities, unknown capability fields and broadened origins', () => {
  for (const override of [
    { projectId: 'not-a-project' },
    { iosBundleIdentifier: 'com.*' },
    { iosBundleIdentifier: 'com.bad_name' },
    { androidPackage: 'com.9bad' },
    { androidPackage: 'com.bad-name' },
    { providerToken: 'never-output' },
    {
      allowedOrigins: [
        ...pins.nativeStagingPush.allowedOrigins,
        'https://evil.example',
      ],
    },
    { allowedOrigins: [...pins.nativeStagingPush.allowedOrigins].reverse() },
    {
      allowedOrigins: [
        'https://ogabassey.com',
        pins.supabaseOrigin,
        'https://exp.host',
      ],
    },
  ])
    assert.throws(
      () =>
        prepare(environment, {
          ...pins,
          nativeStagingPush: { ...pins.nativeStagingPush, ...override },
        }),
      /native pins/
    );
});

test('rejects changed staging scope instead of trusting candidate origins', () => {
  for (const field of [
    'mode',
    'apiOrigin',
    'supabaseOrigin',
    'expectedAuthIssuer',
    'merchantId',
    'publicKeySha256',
  ]) {
    assert.throws(
      () => prepare(environment, { ...pins, [field]: 'wrong' }),
      /staging pins/
    );
  }
});

test('rejects missing public keys, changed hosts, telemetry and competing modes without values', () => {
  for (const field of [
    'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'EXPO_PUBLIC_API_URL',
    'EXPO_PUBLIC_SUPABASE_URL',
    'EXPO_PUBLIC_MERCHANT_ID',
    'EXPO_PUBLIC_HOSTED_STOREFRONT',
    'EXPO_PUBLIC_LOCAL_STOREFRONT',
    'EXPO_PUBLIC_PHONE_QA',
    'EXPO_PUBLIC_POSTHOG_API_KEY',
    'EXPO_PUBLIC_SENTRY_DSN',
    'STOREFRONT_FACEBOOK_APP_ID',
    'STOREFRONT_FACEBOOK_CLIENT_TOKEN',
    'STOREFRONT_TIKTOK_APP_SECRET',
  ]) {
    assert.throws(
      () => prepare({ ...environment, [field]: 'never-output-secret' }),
      (error) =>
        error.message.includes('environment') &&
        !error.message.includes('never-output-secret')
    );
  }
  assert.throws(
    () => prepare({ ...environment, EXPO_PUBLIC_POSTHOG_API_KEY: undefined }),
    /environment/
  );
  assert.throws(
    () => prepare({ ...environment, EXPO_PUBLIC_SUPABASE_ANON_KEY: undefined }),
    /environment/
  );
  assert.throws(
    () =>
      prepare({
        ...environment,
        EXPO_PUBLIC_SUPABASE_ANON_KEY: 'wrong',
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'wrong',
      }),
    /environment/
  );
});

test('the builder still refuses generic EAS/CI and a reviewed profile with hosted mode off', () => {
  const build = loadBuilder();
  for (const override of [
    { EAS_BUILD_PROFILE: 'production' },
    { EAS_BUILD_PROFILE: 'development' },
    { EAS_BUILD_PROFILE: undefined },
    { EXPO_PUBLIC_HOSTED_STOREFRONT: '0' },
    { BACI_REVIEWED_HOSTED_PUSH_BUILD: undefined },
  ])
    assert.throws(() => build({ ...environment, ...override }));
  assert.throws(
    () =>
      build({ ...environment, EAS_BUILD: undefined, NODE_ENV: 'development' }),
    /reviewed EAS profile/
  );
});

test('actual missing native pins stay off for local hosted mode and refuse cloud review', () => {
  const actualPins = require('./hosted-storefront-pins.json');
  assert.equal(actualPins.nativeStagingPush, undefined);
  assert.throws(() => prepare(environment, actualPins), /native pins/);
  const config = loadBuilder({ ...pins, nativeStagingPush: undefined })({
    ...environment,
    EAS_BUILD: undefined,
    EAS_BUILD_PROFILE: undefined,
    CI: undefined,
    NODE_ENV: 'development',
  });
  assert.equal(config.extra.hostedStagingPush, undefined);
  assert.equal(config.extra.eas.projectId, undefined);
});
