import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildOxygenStagingExpoConfig,
} = require('./oxygen-staging-expo-config.js');
const env = {
  NODE_ENV: 'development',
  EXPO_PUBLIC_OXYGEN_STAGING: '1',
  EXPO_PUBLIC_OXYGEN_API_ORIGIN: 'http://127.0.0.1:3000',
  EXPO_PUBLIC_OXYGEN_AUTH_ORIGIN: 'https://staging-auth.example.com',
  EXPO_PUBLIC_OXYGEN_AUTH_ISSUER: 'https://staging-auth.example.com/auth/v1',
  EXPO_PUBLIC_OXYGEN_PUBLIC_KEY: `sb_publishable_${'a'.repeat(24)}`,
  EXPO_PUBLIC_OXYGEN_MERCHANT_ID: '11111111-1111-4111-8111-111111111111',
  EXPO_PUBLIC_OXYGEN_MERCHANT_SLUG: 'oxygen-test',
};
test('normal production configuration excludes Oxygen', () => {
  assert.equal(buildOxygenStagingExpoConfig({ NODE_ENV: 'production' }), null);
});
test('isolates app identity, disables OTA and exporters', () => {
  const config = buildOxygenStagingExpoConfig(env);
  assert.equal(config.ios.bundleIdentifier, 'com.ogabassey.oxygenstaging');
  assert.equal(config.android.package, 'com.ogabassey.oxygenstaging');
  assert.equal(config.updates.enabled, false);
  assert.ok(
    config.plugins.includes('./config/withOxygenStagingAndroidIsolation')
  );
  assert.equal(config.extra.posthogApiKey, '');
  assert.deepEqual(config.extra.eas, {});
  assert.equal(config.extra.apiUrl, env.EXPO_PUBLIC_OXYGEN_API_ORIGIN);
});
for (const override of [
  { NODE_ENV: 'production' },
  { EAS_BUILD: '1' },
  { EAS_BUILD_PROFILE: 'development' },
  { CI: 'true' },
  { EXPO_PUBLIC_LOCAL_STOREFRONT: '1' },
  { EXPO_PUBLIC_HOSTED_STOREFRONT: '1' },
  { EXPO_PUBLIC_PHONE_QA: '1' },
  { EXPO_PUBLIC_API_URL: 'https://usebaci.com' },
  { EXPO_PUBLIC_SUPABASE_URL: 'https://production.example.com' },
  { EXPO_PUBLIC_OXYGEN_AUTH_ISSUER: 'https://foreign.example.com/auth/v1' },
  { EXPO_PUBLIC_OXYGEN_AUTH_ORIGIN: 'http://127.0.0.1:54321' },
  { EXPO_PUBLIC_SENTRY_DSN: 'https://example.com' },
])
  test(`rejects unsafe config ${JSON.stringify(override)}`, () => {
    assert.throws(() => buildOxygenStagingExpoConfig({ ...env, ...override }));
  });
test('loopback API permits local networking without arbitrary transport loads', () => {
  const local = buildOxygenStagingExpoConfig(env);
  assert.deepEqual(local.ios.infoPlist.NSAppTransportSecurity, {
    NSAllowsLocalNetworking: true,
  });
  const hosted = buildOxygenStagingExpoConfig({
    ...env,
    EXPO_PUBLIC_OXYGEN_API_ORIGIN: 'https://staging.example.com',
  });
  assert.equal(hosted.ios.infoPlist.NSAppTransportSecurity, undefined);
});
test('only the exact staging switch selects the isolated profile', () => {
  for (const value of ['true', 'yes', '2', '0', '']) {
    assert.equal(
      buildOxygenStagingExpoConfig({
        ...env,
        EXPO_PUBLIC_OXYGEN_STAGING: value,
      }),
      null
    );
  }
});

const localAnon = (claims = {}) =>
  [
    { alg: 'HS256', typ: 'JWT' },
    {
      iss: 'supabase',
      role: 'anon',
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...claims,
    },
    'synthetic-signature',
  ]
    .map((value, index) =>
      index < 2
        ? Buffer.from(JSON.stringify(value)).toString('base64url')
        : value
    )
    .join('.');
const gatewayEnv = {
  ...env,
  EXPO_PUBLIC_OXYGEN_AUTH_ORIGIN: env.EXPO_PUBLIC_OXYGEN_API_ORIGIN,
  EXPO_PUBLIC_OXYGEN_AUTH_BASE_URL: `${env.EXPO_PUBLIC_OXYGEN_API_ORIGIN}/qa-backend`,
  EXPO_PUBLIC_OXYGEN_AUTH_ISSUER: 'supabase',
  EXPO_PUBLIC_OXYGEN_PUBLIC_KEY: localAnon(),
};
test('local gateway is independently pinned and uses the exact Auth base URL', () => {
  const config = buildOxygenStagingExpoConfig(gatewayEnv);
  assert.equal(
    config.extra.oxygenStaging.authBaseUrl,
    gatewayEnv.EXPO_PUBLIC_OXYGEN_AUTH_BASE_URL
  );
  assert.equal(
    config.extra.supabaseUrl,
    gatewayEnv.EXPO_PUBLIC_OXYGEN_AUTH_BASE_URL
  );
  assert.equal(config.extra.oxygenStaging.expectedAuthIssuer, 'supabase');
  assert.equal(
    buildOxygenStagingExpoConfig(env).extra.oxygenStaging.authBaseUrl,
    env.EXPO_PUBLIC_OXYGEN_AUTH_ORIGIN
  );
});
for (const override of [
  { EXPO_PUBLIC_OXYGEN_AUTH_BASE_URL: undefined },
  {
    EXPO_PUBLIC_OXYGEN_AUTH_BASE_URL: `${env.EXPO_PUBLIC_OXYGEN_API_ORIGIN}/qa-backend/admin`,
  },
  {
    EXPO_PUBLIC_OXYGEN_AUTH_BASE_URL: `${env.EXPO_PUBLIC_OXYGEN_API_ORIGIN}/qa-backend/`,
  },
  { EXPO_PUBLIC_OXYGEN_AUTH_BASE_URL: 'http://127.0.0.1:4000/qa-backend' },
  { EXPO_PUBLIC_OXYGEN_PUBLIC_KEY: localAnon({ role: 'service_role' }) },
  { EXPO_PUBLIC_OXYGEN_PUBLIC_KEY: localAnon({ exp: 1 }) },
  { EXPO_PUBLIC_OXYGEN_PUBLIC_KEY: localAnon({ iss: 'foreign' }) },
  { EXPO_PUBLIC_OXYGEN_PUBLIC_KEY: localAnon({ ref: 'unreviewed-project' }) },
  {
    EXPO_PUBLIC_OXYGEN_PUBLIC_KEY: localAnon({
      project_ref: 'unreviewed-project',
    }),
  },
  {
    EXPO_PUBLIC_OXYGEN_AUTH_ORIGIN: 'http://10.0.2.2:3000',
    EXPO_PUBLIC_OXYGEN_AUTH_BASE_URL: 'http://10.0.2.2:3000/qa-backend',
  },
])
  test('rejects unsafe local gateway or legacy credentials', () => {
    assert.throws(() =>
      buildOxygenStagingExpoConfig({ ...gatewayEnv, ...override })
    );
  });

test('local anon issuer is distinct from the independently pinned staging user-token issuer', () => {
  const config = buildOxygenStagingExpoConfig({
    ...gatewayEnv,
    EXPO_PUBLIC_OXYGEN_AUTH_ISSUER: 'https://staging-auth.example.com/auth/v1',
  });
  assert.equal(
    config.extra.oxygenStaging.expectedAuthIssuer,
    'https://staging-auth.example.com/auth/v1'
  );
  assert.equal(
    config.extra.supabaseAnonKey,
    gatewayEnv.EXPO_PUBLIC_OXYGEN_PUBLIC_KEY
  );
});

test('storage identity stays below native filename limits while retaining every independent scope pin', () => {
  const scopedEnv = {
    ...gatewayEnv,
    EXPO_PUBLIC_OXYGEN_AUTH_ISSUER: 'https://staging-auth.example.com/auth/v1',
  };
  const config = buildOxygenStagingExpoConfig(scopedEnv);
  const prefix = config.extra.oxygenStaging.storagePrefix;
  assert.ok(
    prefix.length < 100,
    'MMKV storage identity must fit its backing filename'
  );
  assert.match(prefix, /^baci-oxygen-staging\.v2\.[0-9a-f]{64}\.$/);
  for (const override of [
    { EXPO_PUBLIC_OXYGEN_API_ORIGIN: 'http://localhost:4000' },
    {
      EXPO_PUBLIC_OXYGEN_AUTH_ISSUER:
        'https://different-staging-auth.example.com/auth/v1',
    },
    { EXPO_PUBLIC_OXYGEN_MERCHANT_ID: '22222222-2222-4222-8222-222222222222' },
    { EXPO_PUBLIC_OXYGEN_MERCHANT_SLUG: 'other-staging' },
  ])
    assert.notEqual(
      buildOxygenStagingExpoConfig({ ...scopedEnv, ...override }).extra
        .oxygenStaging.storagePrefix,
      prefix
    );
});
