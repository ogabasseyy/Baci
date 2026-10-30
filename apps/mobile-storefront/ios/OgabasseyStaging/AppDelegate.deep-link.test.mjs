import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const sourcePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'AppDelegate.swift'
);

test('preserves cold-start custom and universal links through Expo startup', async () => {
  const source = await readFile(sourcePath, 'utf8');
  const connect = source.slice(
    source.indexOf('willConnectTo'),
    source.indexOf('func scene(_ scene: UIScene, openURLContexts')
  );
  const startIndex = connect.indexOf('factory.startReactNative');
  const forwardIndex = connect.indexOf('forward(context, to: appDelegate)');

  assert.notEqual(startIndex, -1, 'scene must start the React Native factory');
  assert.ok(
    forwardIndex > startIndex,
    'cold-start URL contexts must reach Expo after React Native startup'
  );
  assert.match(connect, /launchOptions\[\.url\] = urlContext\.url/);
  assert.match(connect, /activityType == NSUserActivityTypeBrowsingWeb/);
  assert.match(connect, /UIApplicationLaunchOptionsUserActivityDictionaryKey/);
  assert.match(
    connect,
    /UIApplicationLaunchOptionsUserActivityKey.*browsingWebActivity/s
  );
  assert.ok(
    connect.indexOf('for userActivity in connectionOptions.userActivities') >
      startIndex,
    'cold-start universal links must be forwarded after startup'
  );
  assert.equal(
    connect.match(/application\(UIApplication\.shared, continue: userActivity/g)
      ?.length,
    1,
    'each cold-start user activity is forwarded once through the app delegate'
  );
  assert.doesNotMatch(
    connect,
    /RCTLinkingManager/,
    'the scene delegate must not send a second direct React Native event'
  );
});
