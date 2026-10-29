import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STOREFRONT_OTA_CONFIG } from './storefront-ota-constants.mjs';

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
