import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

function runAlignmentCheck(compileSdk, platform) {
  const root = mkdtempSync(join(tmpdir(), 'baci-android-sdk-alignment-'));
  const put = (path, contents) => {
    const destination = join(root, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, contents);
  };

  try {
    put(
      '.github/scripts/android-release-sdk.test.mjs',
      readFileSync(new URL('./android-release-sdk.test.mjs', import.meta.url))
    );
    const buildTools = `${compileSdk}.0.0`;
    const config = `compileSdkVersion: ${compileSdk},\nbuildToolsVersion: '${buildTools}',\n`;
    const properties = `android.compileSdkVersion=${compileSdk}\nandroid.buildToolsVersion=${buildTools}\n`;
    const workflow = `uses: android-actions/setup-android@fixture\n  with:\n    packages: platform-tools ${platform} build-tools;${buildTools}\n`;
    for (const [name, configPath] of [
      ['android-release.yml', 'apps/mobile-admin/app.config.ts'],
      [
        'android-storefront-release.yml',
        'apps/mobile-storefront/config/expo-plugins.js',
      ],
    ]) {
      put(`.github/workflows/${name}`, workflow);
      put(configPath, config);
    }
    for (const app of ['mobile-admin', 'mobile-storefront']) {
      put(`apps/${app}/android/gradle.properties`, properties);
    }
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(
      process.execPath,
      ['--test', '.github/scripts/android-release-sdk.test.mjs'],
      {
        cwd: root,
        encoding: 'utf8',
        env,
      }
    );
    assert.ifError(result.error);
    assert.notEqual(result.status, null, 'SDK alignment check did not finish');
    return result;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('SDK alignment accepts the published integer package for Android 36', () => {
  const result = runAlignmentCheck('36', 'platforms;android-36');
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('SDK alignment accepts the published minor-version package for Android 37', () => {
  const result = runAlignmentCheck('37', 'platforms;android-37.0');
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('SDK alignment rejects mismatched platform package names', () => {
  assert.notEqual(runAlignmentCheck('36', 'platforms;android-36.0').status, 0);
  assert.notEqual(runAlignmentCheck('37', 'platforms;android-37').status, 0);
});
