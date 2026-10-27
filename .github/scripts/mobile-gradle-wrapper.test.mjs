import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { ensureGradleWrapperVersion } = require('./expoAndroidGradleFixes.js');

// https://services.gradle.org/distributions/gradle-9.4.1-bin.zip.sha256
const checksum = '2ab2958f2a1e51120c326cad6f385153bb11ee93b3c216c5fccebfdfbb7ec6cb';
for (const app of ['mobile-admin', 'mobile-storefront']) {
  test(`${app} pins the checksum for its Gradle distribution`, () => {
    const properties = readFileSync(
      new URL(`../../apps/${app}/android/gradle/wrapper/gradle-wrapper.properties`, import.meta.url),
      'utf8'
    );
    assert.match(properties, /gradle-9\.4\.1-bin\.zip/);
    assert.ok(properties.includes(`distributionSha256Sum=${checksum}`));
  });
}

test('clean prebuild writes the official checksum alongside the wrapper version', () => {
  const properties = ensureGradleWrapperVersion('distributionUrl=https\\://services.gradle.org/distributions/gradle-9.3.1-bin.zip\n');
  assert.ok(properties.includes(`distributionSha256Sum=${checksum}`));
});
