const { withAndroidManifest } = require('@expo/config-plugins');

const TOOLS_NAMESPACE = 'http://schemas.android.com/tools';
const SCREEN_ORIENTATION_ATTRIBUTE = 'android:screenOrientation';
const EXPORTED_ATTRIBUTE = 'android:exported';
const TOOLS_REMOVE_ATTRIBUTE = 'tools:remove';
const MAIN_ACTIVITY_NAMES = [
  '.MainActivity',
  'com.ogabassey.store.MainActivity',
];
const ML_KIT_SCANNER_DELEGATE_ACTIVITY =
  'com.google.mlkit.vision.codescanner.internal.GmsBarcodeScanningDelegateActivity';

function ensureToolsNamespace(manifest) {
  manifest.manifest.$ = manifest.manifest.$ ?? {};
  manifest.manifest.$['xmlns:tools'] = TOOLS_NAMESPACE;
}

function getApplication(manifest) {
  manifest.manifest.application = manifest.manifest.application ?? [{}];
  manifest.manifest.application[0].activity =
    manifest.manifest.application[0].activity ?? [];
  return manifest.manifest.application[0];
}

function ensureProfileable(application) {
  if (!application.profileable?.[0]) {
    application.profileable = [{}];
  }
  application.profileable[0].$ = application.profileable[0].$ ?? {};
  application.profileable[0].$['android:shell'] = 'true';
}

function findActivity(application, name) {
  return application.activity.find(
    (activity) => activity.$?.['android:name'] === name
  );
}

function ensureActivity(application, name) {
  const existingActivity = findActivity(application, name);

  if (existingActivity) {
    existingActivity.$ = existingActivity.$ ?? {};
    return existingActivity;
  }

  const activity = {
    $: {
      'android:name': name,
    },
  };
  application.activity.push(activity);
  return activity;
}

function appendToolsRemove(activity, attribute) {
  const currentValue = activity.$[TOOLS_REMOVE_ATTRIBUTE];
  const values = new Set(
    typeof currentValue === 'string'
      ? currentValue
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
      : []
  );

  values.add(attribute);
  activity.$[TOOLS_REMOVE_ATTRIBUTE] = Array.from(values).join(',');
}

function removeScreenOrientation(activity, { addMergeRemoval }) {
  delete activity.$[SCREEN_ORIENTATION_ATTRIBUTE];

  if (addMergeRemoval) {
    appendToolsRemove(activity, SCREEN_ORIENTATION_ATTRIBUTE);
  }
}

function applyAdaptiveAndroidManifest(manifest) {
  ensureToolsNamespace(manifest);

  const application = getApplication(manifest);
  ensureProfileable(application);

  for (const activityName of MAIN_ACTIVITY_NAMES) {
    const activity = findActivity(application, activityName);

    if (activity) {
      removeScreenOrientation(activity, { addMergeRemoval: false });
    }
  }

  const scannerActivity = ensureActivity(
    application,
    ML_KIT_SCANNER_DELEGATE_ACTIVITY
  );
  scannerActivity.$[EXPORTED_ATTRIBUTE] = 'false';
  removeScreenOrientation(scannerActivity, {
    addMergeRemoval: true,
  });

  return manifest;
}

function withAdaptiveAndroidManifest(config) {
  if (config.modResults?.manifest) {
    config.modResults = applyAdaptiveAndroidManifest(config.modResults);
    return config;
  }

  return withAndroidManifest(config, (innerConfig) => {
    innerConfig.modResults = applyAdaptiveAndroidManifest(
      innerConfig.modResults
    );
    return innerConfig;
  });
}

module.exports = withAdaptiveAndroidManifest;
module.exports.applyAdaptiveAndroidManifest = applyAdaptiveAndroidManifest;
