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
    /SceneGeometry\.keyWindow\(\)/,
  ],
  [
    'expo-web-browser',
    'ios/WebAuthSession.swift',
    /SceneGeometry\.keyWindow\(\)/,
  ],
  [
    'expo-apple-authentication',
    'ios/AppleAuthenticationRequest.swift',
    /Utilities\.keyWindow\(\)/,
  ],
  [
    'expo-print',
    'ios/ExpoPrinterSelector.swift',
    /SceneGeometry\.keyWindow\(\)/,
  ],
  [
    'expo-print',
    'ios/ExpoPrintWithPrinter.swift',
    /SceneGeometry\.keyWindow\(\)/,
  ],
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
    /public static func keyWindow\(\)[\s\S]*?return SceneGeometry\.keyWindow\(\)/
  );
  assert.match(source, /return NSApplication\.shared\.keyWindow/);
});
