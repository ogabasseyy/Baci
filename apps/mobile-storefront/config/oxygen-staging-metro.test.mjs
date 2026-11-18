import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { resolveOxygenStagingModule } = require('./oxygen-staging-metro');

test('an isolated staging development build can run without the new native splash module', async () => {
  const modulePath = resolveOxygenStagingModule('react-native-splash-motion', {
    EXPO_PUBLIC_OXYGEN_STAGING: '1',
    NODE_ENV: 'development',
  });
  assert.ok(modulePath);
  const splash = require(modulePath);
  assert.equal(splash.isVisible(), false);
  await splash.waitForIntro();
  await splash.hide();
});

test('other modules and non-staging builds retain normal module resolution', () => {
  assert.equal(
    resolveOxygenStagingModule('react-native-splash-motion', {}),
    null
  );
  assert.equal(
    resolveOxygenStagingModule('react-native-splash-motion', {
      EXPO_PUBLIC_OXYGEN_STAGING: '1',
      NODE_ENV: 'production',
    }),
    null
  );
  assert.equal(
    resolveOxygenStagingModule('another-module', {
      EXPO_PUBLIC_OXYGEN_STAGING: '1',
      NODE_ENV: 'development',
    }),
    null
  );
});
