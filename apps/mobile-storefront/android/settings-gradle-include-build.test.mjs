import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ensureReactNativeFromSourceSettings } from '../config/withReactNativeFromSource.js';

const root = dirname(fileURLToPath(import.meta.url));
const settingsGradle = readFileSync(join(root, 'settings.gradle'), 'utf8');

function countReactNativeIncludeBuilds(contents) {
  return (contents.match(/includeBuild\(expoAutolinking\.reactNative\)/g) ?? [])
    .length;
}

test('settings.gradle includes reactNative composite build exactly once', () => {
  assert.equal(countReactNativeIncludeBuilds(settingsGradle), 1);
});

test('ensureReactNativeFromSourceSettings restores includeBuild after clean-prebuild-like settings', () => {
  const cleanPrebuildLike = `plugins {
  id("com.facebook.react.settings")
  id("expo-autolinking-settings")
}

include ':app'
includeBuild(expoAutolinking.reactNativeGradlePlugin)
`;
  const ensured = ensureReactNativeFromSourceSettings(cleanPrebuildLike);
  assert.equal(countReactNativeIncludeBuilds(ensured), 1);
  assert.match(
    ensured,
    /substitute\(module\("com\.facebook\.react:react-android"\)\)/
  );
});

test('ensureReactNativeFromSourceSettings collapses duplicate includeBuild blocks', () => {
  const duplicated = `${settingsGradle}
includeBuild(expoAutolinking.reactNative) {
  dependencySubstitution {
    substitute(module("com.facebook.react:react-android")).using(project(":packages:react-native:ReactAndroid"))
  }
}
`;
  assert.equal(countReactNativeIncludeBuilds(duplicated), 2);
  assert.equal(
    countReactNativeIncludeBuilds(
      ensureReactNativeFromSourceSettings(duplicated)
    ),
    1
  );
});
