import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const configuration = require('./react-native.config.js');
const packageConfiguration = require('./package.json');

test('staging excludes native advertising SDKs that auto-initialize without production settings', () => {
  for (const dependency of [
    'react-native-google-mobile-ads',
    'react-native-fbsdk-next',
  ]) {
    assert.equal(configuration.dependencies[dependency].platforms.ios, null);
    assert.ok(
      packageConfiguration.expo.autolinking.exclude.includes(dependency)
    );
    assert.equal(
      configuration.dependencies[dependency].platforms.android,
      null
    );
    assert.ok(
      packageConfiguration.expo.autolinking.exclude.includes(dependency)
    );
  }
});

test('staging preserves Expo push native dependency discovery', () => {
  assert.equal(configuration.dependencies['expo-notifications'], undefined);
  assert.equal(configuration.dependencies['expo-dev-client'], undefined);
});
