import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateOtaConfig } from './storefront-ota-config-validation.mjs';

const config = () => ({
  runtimeVersion: '2.1.663',
  ios: { bundleIdentifier: 'com.ogabassey.app', buildNumber: '663' },
  updates: {
    url: 'https://u.expo.dev/c6c1897b-cac8-49b0-85f9-3d277aecc379',
    requestHeaders: { 'expo-channel-name': 'production' },
  },
  extra: {
    merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
    merchantSlug: 'ogabassey',
    merchantDomain: 'ogabassey.com',
    eas: { projectId: 'c6c1897b-cac8-49b0-85f9-3d277aecc379' },
    apiUrl: 'https://usebaci.com',
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'public-anon-key',
    posthogApiKey: 'public-analytics-key',
    facebookAppId: '123456789',
    facebookClientToken: 'client-token',
  },
});

test('accepts a production configuration for its matching runtime', () => {
  assert.doesNotThrow(() => validateOtaConfig(config(), '2.1.663'));
});

test('rejects an update built for a different iOS runtime', () => {
  assert.throws(() => validateOtaConfig(config(), '2.1.662'), /runtime/i);
});

test('rejects an export whose native build number does not match its runtime', () => {
  const wrongBuild = config();
  wrongBuild.ios.buildNumber = '662';
  assert.throws(() => validateOtaConfig(wrongBuild, '2.1.663'), /build/i);
});

test('rejects an update configured for a different merchant', () => {
  const wrongMerchant = config();
  wrongMerchant.extra.merchantId = 'another-merchant';
  assert.throws(() => validateOtaConfig(wrongMerchant, '2.1.663'), /merchant/i);
});

test('rejects an export without the public Supabase credentials', () => {
  const missing = config();
  delete missing.extra.supabaseAnonKey;
  assert.throws(() => validateOtaConfig(missing, '2.1.663'), /supabase/i);
});

test('rejects a manifest for a different update channel', () => {
  const wrongChannel = config();
  wrongChannel.updates.requestHeaders['expo-channel-name'] = 'preview';
  assert.throws(() => validateOtaConfig(wrongChannel, '2.1.663'), /channel/i);
});

test('rejects an export for a different app or Expo project', () => {
  const wrongApp = config();
  wrongApp.ios.bundleIdentifier = 'com.example.other';
  assert.throws(() => validateOtaConfig(wrongApp, '2.1.663'), /app/i);
  const wrongProject = config();
  wrongProject.extra.eas.projectId = 'another-project';
  assert.throws(() => validateOtaConfig(wrongProject, '2.1.663'), /project/i);
});

test('rejects an export configured for a different API', () => {
  const wrongApi = config();
  wrongApi.extra.apiUrl = 'https://example.invalid';
  assert.throws(() => validateOtaConfig(wrongApi, '2.1.663'), /production/i);
});
