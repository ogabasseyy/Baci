import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { parse } = require('yaml');
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

test('Android prebuild and bundle use the same native version code', () => {
  const steps = parse(workflow).jobs['build-and-deploy'].steps;
  const prebuild = steps.find(
    (step) => step.name === 'Generate Android project via Expo prebuild'
  );
  const bundle = steps.find(
    (step) => step.name === 'Build Android App Bundle (storefront)'
  );
  // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub Actions evaluates this expression.
  const versionCode = '${{ env.VERSION_CODE }}';

  assert.equal(prebuild?.env?.ANDROID_VERSION_CODE, versionCode);
  assert.equal(bundle?.env?.ANDROID_VERSION_CODE, versionCode);
});

test('Android fingerprints match across paths without exposing build-only configuration', () => {
  const destination = mkdtempSync(
    join(tmpdir(), 'storefront-fingerprint-test-')
  );
  const syntheticSecret = 'synthetic-tiktok-fingerprint-secret';
  const updatesRoot = dirname(require.resolve('expo-updates/package.json'));
  const repoAlias = join(destination, 'repo-link');
  symlinkSync(join(appRoot, '..', '..'), repoAlias, 'dir');
  const appAlias = join(repoAlias, 'apps/mobile-storefront');
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    EXPO_NO_DOTENV: '1',
    NODE_ENV: 'test',
    CI: '1',
    BACI_MOBILE_BUILD_PLATFORM: 'android',
    ANDROID_VERSION_CODE: '851',
    STOREFRONT_FACEBOOK_APP_ID: '123456789',
    STOREFRONT_FACEBOOK_CLIENT_TOKEN: 'fixture-token',
    EXPO_PUBLIC_POSTHOG_API_KEY: 'fixture-posthog-key',
    STOREFRONT_TIKTOK_APP_SECRET: syntheticSecret,
  };
  try {
    const result = spawnSync(
      process.execPath,
      [
        join(updatesRoot, 'utils/build/createUpdatesResources.js'),
        'android',
        appAlias,
        destination,
        'only-fingerprint',
      ],
      {
        cwd: appRoot,
        encoding: 'utf8',
        timeout: 120_000,
        env,
      }
    );
    assert.equal(result.status, 0, 'fingerprint generation failed');
    assert.equal(
      (result.stdout + result.stderr).includes(syntheticSecret),
      false,
      'fingerprint generation must not print build-only configuration'
    );
    const buildRuntime = readFileSync(join(destination, 'fingerprint'), 'utf8');
    assert.match(buildRuntime, /^[0-9a-f]{40}$/);

    const resolveScript = `
      const { resolveRuntimeVersionAsync } = require(${JSON.stringify(join(updatesRoot, 'utils/build/resolveRuntimeVersionAsync.js'))});
      resolveRuntimeVersionAsync(process.argv[1], 'android', {}, {})
        .then(({ runtimeVersion, fingerprintSources }) => {
          console.log('RUNTIME_RESULT=' + runtimeVersion);
          console.log('CONTAINS_BUILD_SECRET=' + JSON.stringify(fingerprintSources).includes(process.env.STOREFRONT_TIKTOK_APP_SECRET));
        })
        .catch(() => process.exit(1));
    `;
    for (const projectRoot of [appRoot, appAlias]) {
      const resolved = spawnSync(
        process.execPath,
        ['-e', resolveScript, projectRoot],
        {
          cwd: appRoot,
          encoding: 'utf8',
          timeout: 120_000,
          env,
        }
      );
      assert.equal(resolved.status, 0, 'update runtime resolution failed');
      assert.equal(
        (resolved.stdout + resolved.stderr).includes(syntheticSecret),
        false
      );
      const runtimeLines = resolved.stdout
        .split('\n')
        .filter((line) => line.startsWith('RUNTIME_RESULT='));
      assert.deepEqual(runtimeLines, [`RUNTIME_RESULT=${buildRuntime}`]);
      assert.ok(
        resolved.stdout.includes('CONTAINS_BUILD_SECRET=false'),
        'runtime fingerprint sources must not include build-only secrets'
      );
    }

    // EAS can also generate and upload an automatic diagnostic fingerprint.
    const diagnosticScript = `
      const Fingerprint = require('expo/fingerprint');
      Fingerprint.createFingerprintAsync(process.cwd(), { platforms: ['android'] })
        .then(({ sources }) => console.log('DIAGNOSTIC_CONTAINS_BUILD_SECRET=' + JSON.stringify(sources).includes(process.env.STOREFRONT_TIKTOK_APP_SECRET)))
        .catch(() => process.exit(1));
    `;
    const diagnostic = spawnSync(process.execPath, ['-e', diagnosticScript], {
      cwd: appRoot,
      encoding: 'utf8',
      timeout: 120_000,
      env,
    });
    assert.equal(diagnostic.status, 0, 'diagnostic fingerprint failed');
    assert.ok(
      diagnostic.stdout.includes('DIAGNOSTIC_CONTAINS_BUILD_SECRET=false'),
      'diagnostic fingerprint sources must not include build-only secrets'
    );
  } finally {
    rmSync(destination, { recursive: true, force: true });
  }
});

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
