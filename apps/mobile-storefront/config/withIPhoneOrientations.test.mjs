import assert from 'node:assert/strict';
import { test } from 'node:test';
import withIPhoneOrientations from './withIPhoneOrientations.js';

test('drops upside-down on iPhone while preserving both landscapes and all iPad orientations', async () => {
  const allOrientations = [
    'UIInterfaceOrientationPortrait',
    'UIInterfaceOrientationPortraitUpsideDown',
    'UIInterfaceOrientationLandscapeLeft',
    'UIInterfaceOrientationLandscapeRight',
  ];
  const config = withIPhoneOrientations({ name: 'Fixture', slug: 'fixture' });
  const result = await config.mods.ios.infoPlist({
    ...config,
    modRequest: { platform: 'ios', modName: 'infoPlist' },
    modResults: {
      UISupportedInterfaceOrientations: [...allOrientations],
      'UISupportedInterfaceOrientations~ipad': [...allOrientations],
    },
  });
  assert.deepEqual(result.modResults.UISupportedInterfaceOrientations, [
    allOrientations[0],
    allOrientations[2],
    allOrientations[3],
  ]);
  assert.deepEqual(
    result.modResults['UISupportedInterfaceOrientations~ipad'],
    allOrientations
  );
});
