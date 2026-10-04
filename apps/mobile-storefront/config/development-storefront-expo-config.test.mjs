import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const key = 'synthetic-public-key';
const require = createRequire(import.meta.url);
const pins = {
  apiOrigin: 'https://staging.ogabassey.com',
  supabaseOrigin: 'https://staging-auth.ogabassey.com',
  merchantId: '10000000-0000-4000-8000-000000000001',
  publicKeySha256: createHash('sha256').update(key).digest('hex'),
};
const module = { exports: {} };
vm.runInNewContext(
  readFileSync(
    new URL('./development-storefront-expo-config.js', import.meta.url),
    'utf8'
  ),
  {
    module,
    require(name) {
      if (name === 'node:crypto') return { createHash };
      if (name === './hosted-storefront-pins.json') return pins;
      if (name === './local-storefront-expo-config')
        return { buildLocalStorefrontExpoConfig: () => null };
      if (name === './hosted-staging-push-capability') return require(name);
      throw new Error('Unexpected dependency');
    },
  }
);
const build = module.exports.buildDevelopmentStorefrontExpoConfig;
const environment = {
  NODE_ENV: 'development',
  EXPO_PUBLIC_HOSTED_STOREFRONT: '1',
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: key,
  EXPO_PUBLIC_API_URL: pins.apiOrigin,
  EXPO_PUBLIC_SUPABASE_URL: pins.supabaseOrigin,
  EXPO_PUBLIC_MERCHANT_ID: pins.merchantId,
};

test('isolates the manifest from inherited production telemetry and updates', () => {
  const config = build({
    ...environment,
    EXPO_PUBLIC_POSTHOG_API_KEY: 'unwanted',
  });
  assert.equal(config.extra.supabaseAnonKey, key);
  assert.equal(config.extra.hostedStorefront, true);
  assert.equal(config.extra.eas.projectId, undefined);
  assert.equal(config.extra.posthogApiKey, '');
  assert.equal(config.updates.enabled, false);
  assert.equal(JSON.stringify(config).includes('unwanted'), false);
  assert.equal(
    config.plugins.some(
      (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-notifications'
    ),
    false
  );
});

test('adds only the owner-supplied native staging push capability to the hosted manifest', () => {
  pins.nativeStagingPush = {
    allowedOrigins: [pins.apiOrigin, pins.supabaseOrigin, 'https://exp.host'],
    androidPackage: 'com.ogabassey.staging',
    iosBundleIdentifier: 'com.ogabassey.staging',
    projectId: '22222222-2222-4222-8222-222222222222',
  };
  try {
    const config = build(environment);
    assert.equal(
      config.extra.eas.projectId,
      '22222222-2222-4222-8222-222222222222'
    );
    assert.equal(
      config.extra.hostedStagingPush.projectId,
      '22222222-2222-4222-8222-222222222222'
    );
    assert.deepEqual(
      [...config.extra.hostedStagingPush.allowedOrigins],
      pins.nativeStagingPush.allowedOrigins
    );
    assert.equal(config.ios.bundleIdentifier, 'com.ogabassey.staging');
    assert.equal(config.android.package, 'com.ogabassey.staging');
    assert.ok(
      config.plugins.some(
        (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-notifications'
      )
    );
    assert.equal(config.extra.posthogApiKey, '');
    assert.equal(config.extra.facebookAppId, '');
  } finally {
    delete pins.nativeStagingPush;
  }
});

test('preserves the normal configuration path when hosted mode is disabled', () => {
  for (const mode of [undefined, '', '0'])
    assert.equal(build({ EXPO_PUBLIC_HOSTED_STOREFRONT: mode }), null);
});

test('rejects release, CI, malformed mode and competing test modes', () => {
  for (const override of [
    { NODE_ENV: 'production' },
    { CI: 'true' },
    { EAS_BUILD: 'true' },
    { EXPO_PUBLIC_HOSTED_STOREFRONT: 'true' },
    { EXPO_PUBLIC_LOCAL_STOREFRONT: '1' },
    { EXPO_PUBLIC_PHONE_QA: '1' },
  ])
    assert.throws(
      () => build({ ...environment, ...override }),
      /isolated development/
    );
});

test('rejects every mismatched identity and key without exposing values', () => {
  for (const field of [
    'EXPO_PUBLIC_API_URL',
    'EXPO_PUBLIC_SUPABASE_URL',
    'EXPO_PUBLIC_MERCHANT_ID',
    'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'EXPO_PUBLIC_SENTRY_DSN',
  ])
    assert.throws(
      () => build({ ...environment, [field]: 'wrong' }),
      /reviewed pins/
    );
  assert.throws(
    () =>
      build({
        ...environment,
        EXPO_PUBLIC_SUPABASE_ANON_KEY: 'wrong',
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'wrong',
      }),
    /reviewed pins/
  );
});

test('rejects a production project pin regardless of UUID casing', () => {
  pins.nativeStagingPush = {
    allowedOrigins: [pins.apiOrigin, pins.supabaseOrigin, 'https://exp.host'],
    androidPackage: 'com.ogabassey.staging',
    iosBundleIdentifier: 'com.ogabassey.staging',
    projectId: 'C6C1897B-CAC8-49B0-85F9-3D277AECC379',
  };
  try {
    assert.throws(
      () => build(environment),
      /push capability does not match reviewed pins/
    );
  } finally {
    delete pins.nativeStagingPush;
  }
});

test('rejects either production native identifier in the owner-supplied pin', () => {
  for (const nativeIdentity of [
    { androidPackage: 'com.ogabassey.store' },
    { iosBundleIdentifier: 'com.ogabassey.app' },
  ]) {
    pins.nativeStagingPush = {
      allowedOrigins: [pins.apiOrigin, pins.supabaseOrigin, 'https://exp.host'],
      androidPackage: 'com.ogabassey.staging',
      iosBundleIdentifier: 'com.ogabassey.staging',
      projectId: '22222222-2222-4222-8222-222222222222',
      ...nativeIdentity,
    };
    try {
      assert.throws(
        () => build(environment),
        /push capability does not match reviewed pins/
      );
    } finally {
      delete pins.nativeStagingPush;
    }
  }
});
