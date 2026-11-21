import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const {
  applyOxygenStagingAndroidIsolation,
} = require('./withOxygenStagingAndroidIsolation.js');
test('removes automatic Ads initialization without supplying any Ads credentials', () => {
  const manifest = {
    manifest: {
      $: {},
      application: [
        {
          provider: [
            {
              $: {
                'android:name':
                  'com.google.android.gms.ads.MobileAdsInitProvider',
                'android:authorities': 'old.ads',
              },
            },
            {
              $: {
                'android:name': 'example.RequiredProvider',
                'android:authorities': 'required',
              },
            },
          ],
        },
      ],
    },
  };
  applyOxygenStagingAndroidIsolation(manifest);
  const app = manifest.manifest.application[0];
  const ads = app.provider.filter(
    (provider) =>
      provider.$['android:name'] ===
      'com.google.android.gms.ads.MobileAdsInitProvider'
  );
  assert.deepEqual(ads, [
    {
      $: {
        'android:name': 'com.google.android.gms.ads.MobileAdsInitProvider',
        'tools:node': 'remove',
      },
    },
  ]);
  assert.equal(
    app.provider.find(
      (provider) => provider.$['android:name'] === 'example.RequiredProvider'
    ).$['android:authorities'],
    'required'
  );
  assert.equal(
    manifest.manifest.$['xmlns:tools'],
    'http://schemas.android.com/tools'
  );
  assert.equal(JSON.stringify(manifest).includes('ca-app-pub-'), false);
  applyOxygenStagingAndroidIsolation(manifest);
  assert.equal(
    app.provider.filter(
      (provider) =>
        provider.$['android:name'] ===
        'com.google.android.gms.ads.MobileAdsInitProvider'
    ).length,
    1
  );
});
test('disables native telemetry initialization and automatic collection only in the isolated manifest', () => {
  const manifest = { manifest: { application: [{}] } };
  applyOxygenStagingAndroidIsolation(manifest);
  const app = manifest.manifest.application[0];
  for (const name of [
    'com.facebook.sdk.AutoInitEnabled',
    'com.facebook.sdk.AutoLogAppEventsEnabled',
    'com.facebook.sdk.AdvertiserIDCollectionEnabled',
    'firebase_analytics_collection_enabled',
    'firebase_data_collection_default_enabled',
  ]) {
    assert.equal(
      app['meta-data'].find((row) => row.$['android:name'] === name).$[
        'android:value'
      ],
      'false'
    );
  }
});

test('refuses use by a production or unrelated QA profile', () => {
  const plugin = require('./withOxygenStagingAndroidIsolation.js');
  assert.throws(
    () => plugin({ extra: {} }),
    /limited to the Oxygen staging profile/
  );
});
