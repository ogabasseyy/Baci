import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const plugin = require('./withSplashMotionWindowBackground.js');
test('leaves Android system splash ownership with SplashMotion after Expo prebuild', async () => {
  const config = plugin({});
  const result = await config.mods.android.mainActivity({
    modResults: {
      language: 'kt',
      contents: [
        'import expo.modules.splashscreen.SplashScreenManager',
        'class MainActivity : ReactActivity() {',
        '  override fun onCreate(savedInstanceState: Bundle?) {',
        '    // @generated begin expo-splashscreen - expo prebuild (DO NOT MODIFY) sync-test',
        '    SplashScreenManager.registerOnActivity(this)',
        '    // @generated end expo-splashscreen',
        '    super.onCreate(null)',
        '  }',
        '}',
      ].join('\n'),
    },
  });
  assert.doesNotMatch(result.modResults.contents, /SplashScreenManager/);
  assert.match(result.modResults.contents, /super\.onCreate\(null\)/);
});
test('allows clean prebuild when the removed splash plugin has no registration', async () => {
  const config = plugin({});
  const result = await config.mods.android.mainActivity({
    modResults: {
      language: 'kt',
      contents: 'class MainActivity : ReactActivity() {}',
    },
  });
  assert.doesNotMatch(result.modResults.contents, /SplashScreenManager/);
});
test('fails when Expo splash registration remains without generated markers', async () => {
  const config = plugin({});
  await assert.rejects(
    config.mods.android.mainActivity({
      modResults: {
        language: 'kt',
        contents: [
          'import expo.modules.splashscreen.SplashScreenManager',
          'class MainActivity : ReactActivity() {',
          '  override fun onCreate(savedInstanceState: Bundle?) {',
          '    SplashScreenManager.registerOnActivity(this)',
          '  }',
          '}',
        ].join('\n'),
      },
    }),
    /Expo SplashScreenManager registration remains without a generated block/
  );
});
function transform(resources) {
  const config = plugin({});
  return config.mods.android.styles({ modResults: { resources } });
}
test('replaces an existing window background without changing sibling items', async () => {
  const resources = {
    style: [
      {
        $: { name: 'AppTheme' },
        item: [
          { $: { name: 'android:windowBackground' }, _: '@color/old' },
          { $: { name: 'android:colorAccent' }, _: '@color/accent' },
        ],
      },
    ],
  };
  await transform(resources);
  assert.equal(resources.style[0].item[0]._, '@color/splashmotion_background');
  assert.equal(resources.style[0].item[1]._, '@color/accent');
});
test('inserts the background when the theme has no items', async () => {
  const resources = { style: [{ $: { name: 'AppTheme' } }] };
  await transform(resources);
  assert.deepEqual(resources.style[0].item, [
    {
      $: { name: 'android:windowBackground' },
      _: '@color/splashmotion_background',
    },
  ]);
});
test('fails clearly when AppTheme is missing', async () => {
  const resources = { style: [{ $: { name: 'OtherTheme' } }] };
  await assert.rejects(
    transform(resources),
    /AppTheme was not found while configuring the SplashMotion window background/
  );
});
test('fails clearly when the style collection is absent', async () => {
  await assert.rejects(
    transform({}),
    /AppTheme was not found while configuring the SplashMotion window background/
  );
});
