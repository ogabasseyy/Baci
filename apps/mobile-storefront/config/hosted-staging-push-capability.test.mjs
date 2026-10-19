import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { evaluateHostedStagingPushPreflight } from './hosted-staging-push-preflight.mjs';

const require = createRequire(import.meta.url);
const {
  validateHostedStagingPushCapability,
} = require('./hosted-staging-push-capability');
const {
  prepareHostedStagingPushBuild,
} = require('./hosted-staging-push-build');
const key = 'synthetic-capability-regression-key';
const pins = {
  mode: 'hosted-staging',
  apiOrigin: 'https://staging.ogabassey.com',
  supabaseOrigin: 'https://staging-auth.ogabassey.com',
  expectedAuthIssuer: 'https://staging-auth.ogabassey.com/auth/v1',
  merchantId: '10000000-0000-4000-8000-000000000001',
  publicKeySha256: createHash('sha256').update(key).digest('hex'),
};
const capability = {
  projectId: '22222222-2222-4222-8222-222222222222',
  iosBundleIdentifier: 'com.ogabassey.staging',
  androidPackage: 'com.ogabassey.staging',
  allowedOrigins: [pins.apiOrigin, pins.supabaseOrigin, 'https://exp.host'],
};
const environment = {
  NODE_ENV: 'development',
  EXPO_PUBLIC_HOSTED_STOREFRONT: '1',
  EXPO_PUBLIC_API_URL: pins.apiOrigin,
  EXPO_PUBLIC_SUPABASE_URL: pins.supabaseOrigin,
  EXPO_PUBLIC_MERCHANT_ID: pins.merchantId,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: key,
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
  EXPO_PUBLIC_POSTHOG_API_KEY: '',
};
const cloud = {
  ...environment,
  EAS_BUILD: 'true',
  EAS_BUILD_PROFILE: 'hosted-staging-push',
  BACI_REVIEWED_HOSTED_PUSH_BUILD: '1',
};

function localConfig(profile) {
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
  return module.exports.buildDevelopmentStorefrontExpoConfig(environment);
}

function preflight(profile, manifest) {
  return evaluateHostedStagingPushPreflight({
    pins: profile,
    manifest,
    installedPlatform: 'ios',
    installedApplicationId: capability.iosBundleIdentifier,
    easConfig: {
      build: {
        'hosted-staging-push': { distribution: 'internal', env: environment },
      },
    },
  });
}

test('all three entry points accept the same valid native capability without mutating it', () => {
  const profile = { ...pins, nativeStagingPush: structuredClone(capability) };
  const before = structuredClone(profile);
  assert.equal(
    validateHostedStagingPushCapability(profile.nativeStagingPush, profile)
      .valid,
    true
  );
  assert.equal(
    prepareHostedStagingPushBuild(cloud, profile).EAS_BUILD_PROFILE,
    cloud.EAS_BUILD_PROFILE
  );
  const manifest = localConfig(profile);
  assert.equal(preflight(profile, manifest).ready, true);
  assert.deepEqual(profile, before);
});

test('regression: local, cloud and preflight consistently reject invalid formats, extra fields and production IDs', () => {
  const validProfile = { ...pins, nativeStagingPush: capability };
  const manifest = localConfig(validProfile);
  for (const override of [
    { projectId: 'not-a-uuid' },
    { projectId: 'C6C1897B-CAC8-49B0-85F9-3D277AECC379' },
    { iosBundleIdentifier: 'com.*' },
    { iosBundleIdentifier: 'com.bad_name' },
    { iosBundleIdentifier: `com.${'a'.repeat(252)}` },
    { iosBundleIdentifier: 'com.ogabassey.store' },
    { iosBundleIdentifier: 'COM.OGABASSEY.APP' },
    { androidPackage: 'com.9bad' },
    { androidPackage: 'com.bad-name' },
    { androidPackage: `com.${'a'.repeat(252)}` },
    { androidPackage: 'com.ogabassey.app' },
    { androidPackage: 'com.ogabassey.store' },
    { unknownField: 'synthetic-forbidden-value' },
    { allowedOrigins: [...capability.allowedOrigins, 'https://other.example'] },
    { allowedOrigins: [...capability.allowedOrigins].reverse() },
  ]) {
    const candidate = { ...capability, ...override };
    const profile = { ...pins, nativeStagingPush: candidate };
    assert.equal(
      validateHostedStagingPushCapability(candidate, profile).valid,
      false
    );
    assert.throws(() => localConfig(profile), /push capability/);
    assert.throws(
      () => prepareHostedStagingPushBuild(cloud, profile),
      /native pins/
    );
    assert.equal(preflight(profile, manifest).ready, false);
    const manifestCandidate = {
      ...manifest,
      extra: { ...manifest.extra, hostedStagingPush: candidate },
    };
    assert.equal(preflight(validProfile, manifestCandidate).ready, false);
  }
});

test('accepts the native ID length boundary and refuses broadened staging origins', () => {
  const candidate = {
    ...capability,
    iosBundleIdentifier: `com.${'a'.repeat(251)}`,
    androidPackage: `com.${'a'.repeat(251)}`,
  };
  const profile = { ...pins, nativeStagingPush: candidate };
  assert.equal(
    validateHostedStagingPushCapability(candidate, profile).valid,
    true
  );
  assert.doesNotThrow(() => localConfig(profile));
  assert.doesNotThrow(() => prepareHostedStagingPushBuild(cloud, profile));
  assert.equal(
    validateHostedStagingPushCapability(capability, {
      ...pins,
      apiOrigin: 'https://other.example',
    }).valid,
    false
  );
});

test('malformed or missing capabilities return redacted fixed diagnostics', () => {
  for (const candidate of [
    undefined,
    null,
    {},
    [],
    'synthetic-forbidden-value',
  ]) {
    const result = validateHostedStagingPushCapability(candidate, pins);
    assert.equal(result.valid, false);
    assert.equal(
      JSON.stringify(result).includes('synthetic-forbidden-value'),
      false
    );
  }
});
