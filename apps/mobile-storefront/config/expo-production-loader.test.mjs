import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const appRoot = new URL('../', import.meta.url);
function load(overrides = {}) {
  return spawnSync(
    process.execPath,
    [
      '--no-experimental-strip-types',
      '-e',
      `
    const assert = require('node:assert/strict');
    const { evalConfig } = require('@expo/config/build/evalConfig');
    const { config } = evalConfig(require('node:path').resolve('app.config.ts'), { config: {} });
    assert.equal(config.android.versionCode, 1234);
    assert.ok(config.plugins.some(p => Array.isArray(p) && p[0] === '@sentry/react-native/expo'));
  `,
    ],
    {
      cwd: appRoot,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'test',
        CI: '1',
        EAS_BUILD: 'true',
        ANDROID_VERSION_CODE: '1234',
        STOREFRONT_FACEBOOK_APP_ID: 'synthetic-id',
        STOREFRONT_FACEBOOK_CLIENT_TOKEN: 'synthetic-token',
        EXPO_PUBLIC_POSTHOG_API_KEY: 'synthetic-key',
        EXPO_PUBLIC_SENTRY_DSN: 'https://synthetic.example/1',
        SENTRY_ORG: 'synthetic',
        SENTRY_PROJECT: 'synthetic',
        SENTRY_AUTH_TOKEN: 'synthetic',
        ...overrides,
      },
    }
  );
}
test('Expo production loader works with Android release type stripping disabled', () => {
  const result = load();
  assert.equal(result.status, 0, result.stderr);
});
test('real Expo production loader still rejects missing release upload credentials', () => {
  const result = load({ SENTRY_AUTH_TOKEN: '' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing required Sentry configuration/);
});
