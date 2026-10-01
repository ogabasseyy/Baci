const withAdaptiveAndroidManifest = require('./withAdaptiveAndroidManifest');

const ML_KIT_SCANNER_DELEGATE_ACTIVITY =
  'com.google.mlkit.vision.codescanner.internal.GmsBarcodeScanningDelegateActivity';

function buildConfig(activities) {
  return {
    modResults: {
      manifest: {
        $: {
          xmlns: 'http://schemas.android.com/apk/res/android',
        },
        application: [
          {
            activity: activities.map((attributes) => ({
              $: attributes,
            })),
          },
        ],
      },
    },
  };
}

function findActivity(manifest, name) {
  return manifest.manifest.application[0].activity.find(
    (activity) => activity.$['android:name'] === name
  );
}

describe('withAdaptiveAndroidManifest', () => {
  it('removes storefront and scanner orientation locks from Android manifest metadata', () => {
    const config = buildConfig([
      {
        'android:name': '.MainActivity',
        'android:screenOrientation': 'portrait',
      },
      {
        'android:name': ML_KIT_SCANNER_DELEGATE_ACTIVITY,
        'android:screenOrientation': 'portrait',
      },
    ]);

    const updatedConfig = withAdaptiveAndroidManifest(config);
    const manifest = updatedConfig.modResults;

    expect(manifest.manifest.$['xmlns:tools']).toBe(
      'http://schemas.android.com/tools'
    );
    expect(manifest.manifest.application[0].profileable).toEqual([
      { $: { 'android:shell': 'true' } },
    ]);
    expect(findActivity(manifest, '.MainActivity').$).not.toHaveProperty(
      'android:screenOrientation'
    );
    expect(
      findActivity(manifest, ML_KIT_SCANNER_DELEGATE_ACTIVITY).$
    ).toMatchObject({
      'android:exported': 'false',
      'tools:remove': 'android:screenOrientation',
    });
    expect(
      findActivity(manifest, ML_KIT_SCANNER_DELEGATE_ACTIVITY).$
    ).not.toHaveProperty('android:screenOrientation');
  });

  it('preserves profileable metadata while enabling shell tracing', () => {
    const config = buildConfig([]);
    config.modResults.manifest.application[0].profileable = [
      { $: { 'android:shell': 'false', 'tools:targetApi': 'q' } },
    ];

    const application =
      withAdaptiveAndroidManifest(config).modResults.manifest.application[0];

    expect(application.profileable).toEqual([
      {
        $: {
          'android:shell': 'true',
          'tools:targetApi': 'q',
        },
      },
    ]);
  });

  it('repairs empty profileable metadata produced by another manifest mod', () => {
    const config = buildConfig([]);
    config.modResults.manifest.application[0].profileable = [];

    const application =
      withAdaptiveAndroidManifest(config).modResults.manifest.application[0];

    expect(application.profileable).toEqual([
      { $: { 'android:shell': 'true' } },
    ]);
  });

  it('removes orientation from a package-prefixed MainActivity', () => {
    const config = buildConfig([
      {
        'android:name': 'com.ogabassey.store.MainActivity',
        'android:screenOrientation': 'portrait',
      },
    ]);

    const manifest = withAdaptiveAndroidManifest(config).modResults;

    expect(
      findActivity(manifest, 'com.ogabassey.store.MainActivity').$
    ).not.toHaveProperty('android:screenOrientation');
  });

  it('keeps unrelated activities intact when MainActivity is missing', () => {
    const config = buildConfig([
      {
        'android:name': 'com.example.UnrelatedActivity',
        'android:exported': 'false',
      },
    ]);

    const manifest = withAdaptiveAndroidManifest(config).modResults;

    expect(findActivity(manifest, 'com.example.UnrelatedActivity').$).toEqual({
      'android:name': 'com.example.UnrelatedActivity',
      'android:exported': 'false',
    });
  });

  it('preserves existing tools:remove values on the scanner activity', () => {
    const config = buildConfig([
      {
        'android:name': ML_KIT_SCANNER_DELEGATE_ACTIVITY,
        'android:screenOrientation': 'portrait',
        'tools:remove': 'android:theme',
      },
    ]);

    const manifest = withAdaptiveAndroidManifest(config).modResults;

    expect(
      findActivity(manifest, ML_KIT_SCANNER_DELEGATE_ACTIVITY).$
    ).toMatchObject({
      'android:exported': 'false',
      'tools:remove': 'android:theme,android:screenOrientation',
    });
  });

  it('creates a scanner activity override when the scanner comes from a library manifest', () => {
    const config = buildConfig([]);

    const manifest = withAdaptiveAndroidManifest(config).modResults;

    expect(
      findActivity(manifest, ML_KIT_SCANNER_DELEGATE_ACTIVITY).$
    ).toMatchObject({
      'android:name': ML_KIT_SCANNER_DELEGATE_ACTIVITY,
      'android:exported': 'false',
      'tools:remove': 'android:screenOrientation',
    });
  });
});
