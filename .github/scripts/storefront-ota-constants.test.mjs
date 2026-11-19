import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseIosRuntime, STOREFRONT_OTA_CONFIG } from './storefront-ota-constants.mjs';

const appConfig = readFileSync(
  new URL('../../apps/mobile-storefront/config/development-storefront-expo-config-production.js', import.meta.url),
  'utf8',
);

test('pins the intended storefront, merchant and production update service', () => {
  assert.deepEqual(STOREFRONT_OTA_CONFIG, {
    apiUrl: 'https://usebaci.com',
    bundleIdentifier: 'com.ogabassey.app',
    channel: 'production',
    merchantDomain: 'ogabassey.com',
    merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
    merchantSlug: 'ogabassey',
    projectId: 'c6c1897b-cac8-49b0-85f9-3d277aecc379',
    updatesUrl: 'https://u.expo.dev/c6c1897b-cac8-49b0-85f9-3d277aecc379',
  });
  assert.ok(Object.isFrozen(STOREFRONT_OTA_CONFIG));
});

test('parses a runtime from before the SDK 58 upgrade into its app version and build number', () => {
  assert.deepEqual(parseIosRuntime('2.1.663'), { appVersion: '2.1.663', buildNumber: '663' });
});

test('parses the runtime format the storefront app config currently emits', () => {
  const suffix = appConfig.match(/const runtimeVersion = `\$\{iosAppVersion\}(-ios-sdk\d+-rn\d+)`;/)?.[1];
  assert.ok(suffix, 'The app config runtime format changed; update the exporter with it.');
  assert.deepEqual(parseIosRuntime(`2.1.663${suffix}`), { appVersion: '2.1.663', buildNumber: '663' });
});

test('rejects selections that are not an app version with an optional native-stack suffix', () => {
  for (const runtime of ['', '2.1', '2.1.663-', '2.1.663-beta', 'v2.1.663', '2.1.663 ', '2.1.663-ios-sdk59-rn0880', '2.1.663-ios-sdk58-rn0890']) {
    assert.throws(() => parseIosRuntime(runtime), Error, JSON.stringify(runtime));
  }
});
