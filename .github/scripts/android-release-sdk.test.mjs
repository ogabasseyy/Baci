import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

function sdkVersions(source, config) {
  const compile = source.match(/compileSdkVersion:\s*(\d+)/)?.[1];
  const tools = source.match(/buildToolsVersion:\s*['"]([^'"]+)['"]/)?.[1];
  assert.ok(compile && tools, `missing Android SDK versions in ${config}`);
  return { compile, tools };
}

test('reports missing build tools before accessing its value', () => {
  assert.throws(() => sdkVersions('compileSdkVersion: 37', 'fixture'), /missing Android SDK versions in fixture/);
});

for (const [workflow, config, properties] of [
  ['.github/workflows/android-release.yml', 'apps/mobile-admin/app.config.ts', 'apps/mobile-admin/android/gradle.properties'],
  ['.github/workflows/android-storefront-release.yml', 'apps/mobile-storefront/config/expo-plugins.js', 'apps/mobile-storefront/android/gradle.properties'],
]) {
  test(`${workflow} provisions the SDK requested by Expo prebuild`, () => {
    const source = read(config);
    const { compile, tools } = sdkVersions(source, config);
    const native = read(properties);
    assert.match(native, new RegExp(`^android\\.compileSdkVersion=${compile}$`, 'm'));
    assert.match(native, new RegExp(`^android\\.buildToolsVersion=${tools.replaceAll('.', '\\.')}$`, 'm'));
    const packagesLine = read(workflow).match(
      /uses: android-actions\/setup-android@[^\n]*\n\s*with:\n\s*packages: ([^\n]+)/,
    )?.[1];
    assert.ok(packagesLine, `missing Android setup packages in ${workflow}`);
    const packages = packagesLine.trim().split(/\s+/);
    const platformPackage = `platforms;android-${compile}${Number(compile) >= 37 ? '.0' : ''}`;
    assert.ok(packages.includes(platformPackage));
    assert.ok(packages.includes(`build-tools;${tools}`));
    assert.deepEqual(packages.filter((value) => value.startsWith("platforms;")), [platformPackage]);
    assert.deepEqual(packages.filter((value) => value.startsWith("build-tools;")), [`build-tools;${tools}`]);
  });
}
