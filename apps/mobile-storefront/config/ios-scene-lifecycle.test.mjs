import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const plist = require('@expo/plist').default;
const nativeRoot = new URL('../ios/Ogabassey/', import.meta.url);

test('checked-in scene manifest resolves Expo scene startup on iOS 27', () => {
  const info = plist.parse(
    readFileSync(new URL('Info.plist', nativeRoot), 'utf8')
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(info.UIApplicationSceneManifest)),
    {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
          },
        ],
      },
    }
  );
});

test('AppDelegate provides the React factory and preserves forwarded link callbacks', () => {
  const source = readFileSync(new URL('AppDelegate.swift', nativeRoot), 'utf8');
  assert.match(
    source,
    /class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider/
  );
  assert.match(source, /reactNativeFactory = factory/);
  assert.doesNotMatch(source, /window = UIWindow|factory\.startReactNative/);
  const delegate = readFileSync(
    new URL('SceneDelegate.swift', nativeRoot),
    'utf8'
  );
  assert.match(delegate, /class SceneDelegate: ExpoAppSceneDelegate/);
  const expoDelegate = readFileSync(
    join(
      dirname(require.resolve('expo/package.json')),
      'ios/Expo/ExpoAppSceneDelegate.swift'
    ),
    'utf8'
  );
  assert.match(expoDelegate, /scene:openURLContexts:/);
  assert.match(expoDelegate, /scene:continueUserActivity:/);
  assert.match(expoDelegate, /RCTLinkingManager/);
});
