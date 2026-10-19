import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const appRoot = fileURLToPath(new URL('..', import.meta.url));
const workflow = readFileSync(
  new URL(
    '../../../.github/workflows/android-storefront-release.yml',
    import.meta.url
  ),
  'utf8'
);
const declaredOptions = workflow.match(
  /^\s*ANDROID_NODE_OPTIONS:\s*(.+)$/m
)?.[1];
const nodeOptions = declaredOptions
  ?.match(/^(?:"([^"]*)"|'([^']*)'|([^#]*))(?:\s*#.*)?$/)
  ?.slice(1)
  .find((value) => value !== undefined)
  ?.trim();

test('Android release Node options load the full Expo TypeScript config chain', () => {
  assert.ok(nodeOptions, 'release workflow must declare its Node options');
  const result = spawnSync(
    process.execPath,
    [require.resolve('expo/bin/cli'), 'config', '--type', 'public', '--json'],
    {
      cwd: appRoot,
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            ([key]) =>
              !/^(EXPO_|EAS_|SENTRY_|STOREFRONT_|ANDROID_|IOS_|GOOGLE_|TIKTOK_|POSTHOG_)/.test(
                key
              )
          )
        ),
        EXPO_NO_DOTENV: '1',
        NODE_OPTIONS: nodeOptions,
        NODE_ENV: 'test',
        CI: '1',
        BACI_MOBILE_BUILD_PLATFORM: 'android',
        ANDROID_VERSION_CODE: '851',
        STOREFRONT_FACEBOOK_APP_ID: '123456789',
        STOREFRONT_FACEBOOK_CLIENT_TOKEN: 'fixture-token',
        EXPO_PUBLIC_POSTHOG_API_KEY: 'fixture-posthog-key',
        EXPO_PUBLIC_SENTRY_DSN: '',
        EXPO_PUBLIC_HOSTED_STOREFRONT: '',
        EXPO_PUBLIC_LOCAL_STOREFRONT: '',
      },
    }
  );
  // Do not echo the resolved config or inherited build credentials on failure.
  assert.equal(
    result.status,
    0,
    'Expo config failed under the Android release Node options'
  );
  const config = JSON.parse(result.stdout);
  assert.equal(config.version, '2.0.1');
  assert.equal(config.android.package, 'com.ogabassey.store');
  assert.equal(config.android.versionCode, 851);
});
