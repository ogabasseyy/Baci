import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  assertNoPrivateValues,
  validateExportMetadata,
  validateOtaConfig,
} from './storefront-ota-export-validation.mjs';

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

test('rejects a build-only secret in an exported bundle', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ota-validation-'));
  try {
    await writeFile(path.join(directory, 'bundle.js'), 'prefix private-build-token suffix');
    await assert.rejects(
      assertNoPrivateValues(directory, { SENTRY_AUTH_TOKEN: 'private-build-token' }),
      /SENTRY_AUTH_TOKEN/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects a secret scan if an expected build-only secret is missing', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ota-validation-'));
  try {
    await assert.rejects(
      assertNoPrivateValues(directory, { SENTRY_AUTH_TOKEN: undefined }),
      /SENTRY_AUTH_TOKEN/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects an export whose bundle was built from a different revision', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ota-metadata-'));
  try {
    await writeFile(path.join(directory, 'bundle.hbc'), 'wrong-revision');
    await writeFile(
      path.join(directory, 'metadata.json'),
      JSON.stringify({ fileMetadata: { ios: { bundle: 'bundle.hbc', assets: [] } } })
    );
    await assert.rejects(
      validateExportMetadata(directory, '11d3af0992600ba26e7d9a69f533ffc6737737b4'),
      /revision/i
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('accepts an iOS export with its stated revision and available assets', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ota-metadata-'));
  const sha = '11d3af0992600ba26e7d9a69f533ffc6737737b4';
  try {
    await writeFile(path.join(directory, 'bundle.hbc'), `bundle-${sha}`);
    await writeFile(path.join(directory, 'bundle.hbc.map'), '{}');
    await writeFile(path.join(directory, 'asset.png'), 'asset');
    await writeFile(
      path.join(directory, 'metadata.json'),
      JSON.stringify({
        fileMetadata: { ios: { bundle: 'bundle.hbc', assets: [{ path: 'asset.png' }] } },
      })
    );
    await assert.doesNotReject(validateExportMetadata(directory, sha));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects an export that omitted the bundle source map', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ota-metadata-'));
  const sha = '11d3af0992600ba26e7d9a69f533ffc6737737b4';
  try {
    await writeFile(path.join(directory, 'bundle.hbc'), `bundle-${sha}`);
    await writeFile(path.join(directory, 'metadata.json'), JSON.stringify({
      fileMetadata: { ios: { bundle: 'bundle.hbc', assets: [] } },
    }));
    await assert.rejects(validateExportMetadata(directory, sha), /source map/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
