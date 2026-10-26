import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const nativeDirectory = new URL('../ios/OgabasseyStaging/', import.meta.url);
const delegate = readFileSync(
  new URL('AppDelegate.swift', nativeDirectory),
  'utf8'
);
const manifest = readFileSync(new URL('Info.plist', nativeDirectory), 'utf8');

test('staging launch uses a scene window instead of the iOS 27 rejected legacy lifecycle', () => {
  assert.match(manifest, /UIApplicationSceneManifest/);
  assert.match(
    manifest,
    /UISceneDelegateClassName<\/key>\s*<string>StagingSceneDelegate/
  );
  assert.match(delegate, /@objc\(StagingSceneDelegate\)/);
  assert.match(delegate, /UIWindow\(windowScene: windowScene\)/);
  assert.doesNotMatch(delegate, /UIWindow\(frame: UIScreen\.main\.bounds\)/);
  assert.equal(delegate.match(/factory\.startReactNative\(/g)?.length, 1);
  assert.match(delegate, /appDelegate\.window = sceneWindow/);
});

test('scene forwards notification launches, deep links and foreground events to Expo', () => {
  assert.match(delegate, /connectionOptions\.notificationResponse/);
  assert.match(delegate, /launchOptions\[\.remoteNotification\]/);
  assert.match(delegate, /launchOptions\[\.url\] = urlContext\.url/);
  for (const callback of [
    'openURLContexts',
    'applicationDidBecomeActive',
    'applicationWillResignActive',
    'applicationWillEnterForeground',
    'applicationDidEnterBackground',
  ]) {
    assert.ok(delegate.includes(callback));
  }
});
