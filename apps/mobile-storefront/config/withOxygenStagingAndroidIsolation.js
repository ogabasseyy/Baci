const { withAndroidManifest } = require('@expo/config-plugins');

const AUTOMATIC_PROVIDERS = [
  'com.google.android.gms.ads.MobileAdsInitProvider',
  'com.facebook.internal.FacebookInitProvider',
  'com.google.firebase.provider.FirebaseInitProvider',
  'io.sentry.android.core.SentryInitProvider',
  'io.sentry.android.core.SentryPerformanceProvider',
];
const DISABLED_COLLECTION = [
  'com.facebook.sdk.AutoInitEnabled',
  'com.facebook.sdk.AutoLogAppEventsEnabled',
  'com.facebook.sdk.AdvertiserIDCollectionEnabled',
  'firebase_analytics_collection_enabled',
  'firebase_crashlytics_collection_enabled',
  'firebase_data_collection_default_enabled',
];
const CREDENTIAL_METADATA = [
  'com.google.android.gms.ads.APPLICATION_ID',
  'com.facebook.sdk.ApplicationId',
  'com.facebook.sdk.ClientToken',
];

function applyOxygenStagingAndroidIsolation(manifest) {
  manifest.manifest.$ ??= {};
  manifest.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
  const application = manifest.manifest.application?.[0];
  if (!application)
    throw new Error('Oxygen staging requires an Android application manifest');
  application.provider = (application.provider ?? []).filter(
    (provider) => !AUTOMATIC_PROVIDERS.includes(provider.$?.['android:name'])
  );
  for (const name of AUTOMATIC_PROVIDERS) {
    application.provider.push({
      $: { 'android:name': name, 'tools:node': 'remove' },
    });
  }
  application['meta-data'] = (application['meta-data'] ?? []).filter(
    (row) =>
      ![...DISABLED_COLLECTION, ...CREDENTIAL_METADATA].includes(
        row.$?.['android:name']
      )
  );
  for (const name of DISABLED_COLLECTION) {
    application['meta-data'].push({
      $: { 'android:name': name, 'android:value': 'false' },
    });
  }
  return manifest;
}

function withOxygenStagingAndroidIsolation(config) {
  if (config.extra?.oxygenStaging?.appId !== 'com.ogabassey.oxygenstaging')
    throw new Error(
      'Android telemetry isolation is limited to the Oxygen staging profile'
    );
  return withAndroidManifest(config, (result) => {
    result.modResults = applyOxygenStagingAndroidIsolation(result.modResults);
    return result;
  });
}
module.exports = withOxygenStagingAndroidIsolation;
module.exports.applyOxygenStagingAndroidIsolation =
  applyOxygenStagingAndroidIsolation;
