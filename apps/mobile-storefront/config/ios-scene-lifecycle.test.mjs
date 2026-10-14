import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
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
            UISceneDelegateClassName: 'EXExpoAppSceneDelegate',
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
  assert.match(
    source,
    /RCTLinkingManager\.application\(app, open: url, options: options\)/
  );
  assert.match(
    source,
    /RCTLinkingManager\.application\(application, continue: userActivity/
  );
});
