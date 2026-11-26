import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { STOREFRONT_OTA_CONFIG } from './storefront-ota-constants.mjs';
import { verifySelfHostedOtaExport } from './verify-storefront-self-hosted-ota-export.mjs';

const tempDirs = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function createExportDir({ platform = 'ios', updatesUrl = 'https://ota.usebaci.com/api/manifest', secretLeak = '' } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ota-verify-test-'));
  tempDirs.push(dir);
  const sourceSha = 'a'.repeat(40);
  const runtimeVersion = platform === 'ios' ? '2.1.663-ios-sdk58-rn0880-splashmotion1' : '2.0.1-android-sdk58-rn0880-splashmotion1';
  const bundleRel = `_expo/static/js/${platform}/entry.hbc`;
  await mkdir(path.join(dir, 'dist', path.dirname(bundleRel)), { recursive: true });
  await mkdir(path.join(dir, 'dist', 'assets'), { recursive: true });
  await writeFile(path.join(dir, 'dist', bundleRel), `bundle(${sourceSha})${secretLeak}`);
  await writeFile(path.join(dir, 'dist', `${bundleRel}.map`), '{}');
  await writeFile(path.join(dir, 'dist', 'assets', 'logo.png'), 'png');
  await writeFile(
    path.join(dir, 'dist', 'metadata.json'),
    JSON.stringify({
      version: 0,
      fileMetadata: {
        [platform]: {
          bundle: bundleRel,
          assets: [{ path: 'assets/logo.png', ext: 'png' }],
        },
      },
    })
  );
  await writeFile(
    path.join(dir, 'expo-config.json'),
    JSON.stringify({
      ios: { bundleIdentifier: STOREFRONT_OTA_CONFIG.bundleIdentifier, buildNumber: '663', runtimeVersion },
      android: { package: 'com.ogabassey.store', runtimeVersion },
      updates: { url: updatesUrl, requestHeaders: { 'expo-channel-name': 'production' } },
      extra: {
        eas: { projectId: STOREFRONT_OTA_CONFIG.projectId },
        merchantId: STOREFRONT_OTA_CONFIG.merchantId,
        merchantSlug: STOREFRONT_OTA_CONFIG.merchantSlug,
        merchantDomain: STOREFRONT_OTA_CONFIG.merchantDomain,
        apiUrl: STOREFRONT_OTA_CONFIG.apiUrl,
        supabaseUrl: 'https://supabase.example.co',
        supabaseAnonKey: 'anon-key',
        posthogApiKey: 'phc_key',
        facebookAppId: '123456',
        facebookClientToken: 'fb-client-token',
      },
    })
  );
  return { dir, runtimeVersion, sourceSha };
}

test('verifies valid iOS and Android self-hosted OTA exports and writes provenance', async () => {
  const secrets = {
    SENTRY_AUTH_TOKEN: 'sentry-secret-token-value',
    STOREFRONT_TIKTOK_APP_SECRET: 'tiktok-secret-value',
    OTA_ADMIN_TOKEN: 'ota-admin-secret-value',
  };
  for (const platform of ['ios', 'android']) {
    const { dir, runtimeVersion, sourceSha } = await createExportDir({ platform });
    const res = await verifySelfHostedOtaExport({
      directory: dir,
      platform,
      runtimeVersion,
      channel: 'production',
      sourceSha,
      expectedUpdatesUrl: 'https://ota.usebaci.com/api/manifest',
      secrets,
    });
    assert.match(res.provenanceSha256, /^[a-f0-9]{64}$/);
    const provenance = JSON.parse(await readFile(path.join(dir, 'provenance.json'), 'utf8'));
    assert.equal(provenance.platform, platform);
    assert.equal(provenance.updatesUrl, 'https://ota.usebaci.com/api/manifest');
  }
});

test('rejects mismatched updatesUrl or leaked OTA_ADMIN_TOKEN secret', async () => {
  const secrets = {
    SENTRY_AUTH_TOKEN: 'sentry-secret-token-value',
    STOREFRONT_TIKTOK_APP_SECRET: 'tiktok-secret-value',
    OTA_ADMIN_TOKEN: 'ota-admin-secret-value',
  };
  const wrongUrl = await createExportDir({ updatesUrl: 'https://u.expo.dev/wrong' });
  await assert.rejects(
    verifySelfHostedOtaExport({
      directory: wrongUrl.dir,
      platform: 'ios',
      runtimeVersion: wrongUrl.runtimeVersion,
      channel: 'production',
      sourceSha: wrongUrl.sourceSha,
      expectedUpdatesUrl: 'https://ota.usebaci.com/api/manifest',
      secrets,
    }),
    /updates URL/
  );

  const leaked = await createExportDir({ secretLeak: 'ota-admin-secret-value' });
  await assert.rejects(
    verifySelfHostedOtaExport({
      directory: leaked.dir,
      platform: 'ios',
      runtimeVersion: leaked.runtimeVersion,
      channel: 'production',
      sourceSha: leaked.sourceSha,
      expectedUpdatesUrl: 'https://ota.usebaci.com/api/manifest',
      secrets,
    }),
    /OTA_ADMIN_TOKEN/
  );
});
