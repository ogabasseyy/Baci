import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const cases = [
  [
    'expo-modules-core',
    'ios/Utilities/Utilities.swift',
    /var controller = Self\.keyWindow\(\)/,
  ],
  [
    'expo-web-browser',
    'ios/WebBrowserSession.swift',
    /Utilities\.keyWindow\(\)/,
  ],
  ['expo-web-browser', 'ios/WebAuthSession.swift', /Utilities\.keyWindow\(\)/],
  [
    'expo-apple-authentication',
    'ios/AppleAuthenticationRequest.swift',
    /Utilities\.keyWindow\(\)/,
  ],
  ['expo-print', 'ios/ExpoPrinterSelector.swift', /Utilities\.keyWindow\(\)/],
  ['expo-print', 'ios/ExpoPrintWithPrinter.swift', /Utilities\.keyWindow\(\)/],
];

for (const [name, path, sceneLookup] of cases) {
  test(`${name} ${path} presents from the scene instead of the legacy window`, () => {
    const source = readFileSync(
      resolve(dirname(require.resolve(`${name}/package.json`)), path),
      'utf8'
    );
    assert.doesNotMatch(source, /UIApplication\.shared\.keyWindow/);
    assert.match(source, sceneLookup);
  });
}

test('the shared presentation helper resolves the scene window on iOS and preserves macOS', () => {
  const source = readFileSync(
    resolve(
      dirname(require.resolve('expo-modules-core/package.json')),
      'ios/Utilities/Utilities.swift'
    ),
    'utf8'
  );
  assert.match(
    source,
    /public static func keyWindow\(\)[\s\S]*?SceneGeometry\.keyWindow\(\)/
  );
  assert.match(source, /return NSApplication\.shared\.keyWindow/);
});

test('both mobile consumers compile the patched core instead of a prebuilt API', () => {
  const root = resolve(import.meta.dirname, '../../..');
  const adminConfig = readFileSync(
    resolve(root, 'apps/mobile-admin/app.config.ts'),
    'utf8'
  );
  assert.match(adminConfig, /usePrecompiledModules: false/);
  for (const app of ['mobile-admin', 'mobile-storefront']) {
    const properties = JSON.parse(
      readFileSync(
        resolve(root, `apps/${app}/ios/Podfile.properties.json`),
        'utf8'
      )
    );
    assert.equal(properties.EXPO_USE_PRECOMPILED_MODULES, 'false');
  }
});
