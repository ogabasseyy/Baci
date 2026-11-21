import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  const names = [
    '../components/oxygen-preview/visual-qa-route',
    '@/components/oxygen-preview/visual-qa-route.tsx',
    '..\\components\\oxygen-preview\\visual-qa-route',
  ];
  const staging = { EXPO_PUBLIC_OXYGEN_STAGING: '1' };
  for (const name of names) {
    const development = { ...staging, NODE_ENV: 'development' };
    assert.equal(resolveOxygenStagingModule(name, development), null);
    for (const env of [
      { NODE_ENV: 'production' },
      { ...staging, NODE_ENV: 'production' },
      { ...development, EAS_BUILD: '1' },
      { ...development, EAS_BUILD_PROFILE: 'development' },
      { ...development, CI: 'true' },
    ]) {
      const stub = resolveOxygenStagingModule(name, env);
      assert.ok(stub?.endsWith('oxygen-preview-release.js'));
      assert.equal(require(stub).OxygenVisualQaRoute, null);
    }
  }
});

test('the app route resolves its preview import to the release stub', () => {
  const source = readFileSync(
    new URL('../app/oxygen-visual-qa.tsx', import.meta.url),
    'utf8'
  );
  const specifier =
    /import\s*\{\s*OxygenVisualQaRoute\s*\}\s*from\s*['"]([^'"]+)['"]/.exec(
      source
    )?.[1];
  assert.ok(specifier, 'the Expo route must use a resolvable preview import');
  const stub = resolveOxygenStagingModule(specifier, {
    NODE_ENV: 'production',
  });
  assert.equal(stub, require.resolve('./oxygen-preview-release'));
  assert.equal(require(stub).OxygenVisualQaRoute, null);
});
