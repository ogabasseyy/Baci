import assert from 'node:assert/strict';
import test from 'node:test';
import { serializeAndEvaluate } from '@expo/config/build/Serialize.js';
import { buildLocalStorefrontEnvironment } from '../../../tools/test/local-storefront-environment.mjs';
import configuration from './local-storefront-expo-config.js';

const anonKey = [
  Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString(
    'base64url'
  ),
  Buffer.from(JSON.stringify({ role: 'anon', iss: 'supabase-demo' })).toString(
    'base64url'
  ),
  Buffer.alloc(32).toString('base64url'),
].join('.');
const { environment } = buildLocalStorefrontEnvironment({
  apiOrigin: 'http://192.168.100.70:4193',
  supabaseOrigin: 'http://192.168.100.70:4192',
  supabaseAnonKey: anonKey,
  token: 'a'.repeat(48),
  expectedAuthIssuer: 'http://127.0.0.1:55431/auth/v1',
  merchantId: '10000000-0000-4000-8000-000000000001',
});

test('replaces all manifest extras and provider configuration with local values', () => {
  const config = configuration.buildLocalStorefrontExpoConfig({
    ...environment,
    EXPO_PUBLIC_POSTHOG_API_KEY: 'production',
    STOREFRONT_FACEBOOK_CLIENT_TOKEN: 'production',
  });
  assert.equal(config.extra.merchantId, environment.EXPO_PUBLIC_MERCHANT_ID);
  assert.equal(config.extra.supabasePublishableKey, anonKey);
  assert.equal(config.extra.apiUrl, environment.EXPO_PUBLIC_API_URL);
  assert.equal(config.extra.posthogApiKey, '');
  assert.equal(config.extra.facebookClientToken, '');
  assert.equal(config.extra.tiktokBusiness.isConfigured, false);
  assert.deepEqual(config.extra.eas, {});
  assert.deepEqual(config.updates, { enabled: false });
  assert.equal(config.ios.googleServicesFile, undefined);
  assert.ok(!JSON.stringify(config).includes('production'));
  assert.ok(
    !JSON.stringify(config).includes(
      environment.EXPO_PUBLIC_LOCAL_STOREFRONT_TOKEN
    )
  );
});

test('keeps disabled credentials falsy after Expo public manifest serialization', () => {
  const config = serializeAndEvaluate(
    configuration.buildLocalStorefrontExpoConfig(environment)
  );
  assert.equal(Boolean(config.extra.facebookAppId), false);
  assert.equal(Boolean(config.extra.facebookClientToken), false);
});

test('rejects missing, non-loopback and malformed expected Auth issuers', () => {
  for (const issuer of [
    undefined,
    '',
    'https://hosted.supabase.co/auth/v1',
    'http://192.168.100.70:55431/auth/v1',
    'http://localhost:55431/auth/v1',
    'http://127.0.0.1:65536/auth/v1',
    'http://127.0.0.1:55431/auth/v1/',
  ]) {
    assert.throws(
      () =>
        configuration.buildLocalStorefrontExpoConfig({
          ...environment,
          EXPO_PUBLIC_LOCAL_AUTH_ISSUER: issuer,
        }),
      /explicit loopback Auth issuer/
    );
  }
});

test('preserves the normal production config path and forbids local EAS/release config', () => {
  assert.equal(configuration.buildLocalStorefrontExpoConfig({}), null);
  for (const override of [
    { NODE_ENV: 'production' },
    { CI: '1' },
    { EAS_BUILD: 'true' },
  ]) {
    assert.throws(
      () =>
        configuration.buildLocalStorefrontExpoConfig({
          ...environment,
          ...override,
        }),
      /isolated development/
    );
  }
});
