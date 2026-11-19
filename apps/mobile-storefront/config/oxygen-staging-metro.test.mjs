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

test('resolves the Oxygen preview fixture graph only in staging development', () => {
  const name = '../components/oxygen-preview/entry';
  const staging = { EXPO_PUBLIC_OXYGEN_STAGING: '1' };
  assert.equal(
    resolveOxygenStagingModule(name, { ...staging, NODE_ENV: 'development' }),
    null
  );
  for (const env of [
    { NODE_ENV: 'production' },
    { ...staging, NODE_ENV: 'production' },
  ]) {
    const stub = resolveOxygenStagingModule(name, env);
    assert.ok(stub?.endsWith('oxygen-preview-release.js'));
    assert.deepEqual(require(stub).previewSteps, []);
  }
});

test('includes the native bank logos only in the local staging development build', () => {
  const name = './oxygen-bank-logos';
  const local = { EXPO_PUBLIC_OXYGEN_STAGING: '1', NODE_ENV: 'development' };
  assert.equal(resolveOxygenStagingModule(name, local), null);
  for (const env of [
    { NODE_ENV: 'development' },
    { ...local, NODE_ENV: 'production' },
    { ...local, EAS_BUILD_PROFILE: 'development' },
    { ...local, EAS_BUILD: '1' },
    { ...local, CI: 'true' },
  ]) {
    const stub = resolveOxygenStagingModule(name, env);
    assert.ok(stub?.endsWith('oxygen-bank-logos-release.js'));
    assert.equal(require(stub).oxygenBankLogo('058'), undefined);
  }
});
