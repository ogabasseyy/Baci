import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateBenchmarkApk } from './android-benchmark-native-check.mjs';

test('checks the benchmark APK for its only packaged ABI before reporting it', () => {
  let invocation;
  validateBenchmarkApk({
    appDir: '/repo/apps/mobile-storefront',
    artifactPath: '/repo/apps/mobile-storefront/android/app/build/outputs/apk/release/app-release.apk',
    execute: (...args) => {
      invocation = args;
    },
  });

  assert.deepEqual(invocation, [
    'Validating benchmark APK native libraries',
    process.execPath,
    [
      '/repo/.github/scripts/android-native-library-check.mjs',
      '/repo/apps/mobile-storefront/android/app/build/outputs/apk/release/app-release.apk',
      '--abis',
      'arm64-v8a',
    ],
    '/repo/apps/mobile-storefront',
  ]);
});
