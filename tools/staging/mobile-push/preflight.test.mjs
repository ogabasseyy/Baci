import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const key = 'synthetic-staging-public-key';
const baseline = {
  mode: 'hosted-staging',
  apiOrigin: 'https://staging.ogabassey.com',
  supabaseOrigin: 'https://staging-auth.ogabassey.com',
  expectedAuthIssuer: 'https://staging-auth.ogabassey.com/auth/v1',
  merchantId: '10000000-0000-4000-8000-000000000001',
  publicKeySha256: createHash('sha256').update(key).digest('hex'),
};
const pins = {
  ...baseline,
  nativeStagingPush: {
    projectId: '22222222-2222-4222-8222-222222222222',
    iosBundleIdentifier: 'com.ogabassey.staging',
    androidPackage: 'com.ogabassey.staging',
    allowedOrigins: [
      baseline.apiOrigin,
      baseline.supabaseOrigin,
      'https://exp.host',
    ],
  },
};

function profile() {
  const template = JSON.parse(
    readFileSync(
      new URL('./eas-profile.template.json', import.meta.url),
      'utf8'
    )
  );
  template.build['hosted-staging-push'].env.EXPO_PUBLIC_SUPABASE_ANON_KEY = key;
  template.build[
    'hosted-staging-push'
  ].env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = key;
  return template;
}

async function evaluate(candidate = pins, fragment = profile()) {
  const { evaluateHostedStagingPushBuildPreparation } = await import(
    './preflight.mjs'
  );
  return evaluateHostedStagingPushBuildPreparation(
    candidate,
    fragment,
    baseline
  );
}

test('validates only the deferred profile without claiming build or phone acceptance', async () => {
  const result = await evaluate();
  assert.equal(result.prepared, true);
  assert.equal(result.buildAuthorized, false);
  assert.equal(result.deviceAcceptanceVerified, false);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.configResolutionVerified, true);
  assert.match(result.manifestSha256, /^[0-9a-f]{64}$/);
  assert.equal(
    result.remainingGates.includes('resolved-staging-config-required'),
    false
  );
  assert.equal(JSON.stringify(result).includes(key), false);
  assert.equal(
    JSON.stringify(result).includes(pins.nativeStagingPush.projectId),
    false
  );
});

test('candidate pins cannot silently replace the reviewed public-key fingerprint', async () => {
  const candidate = { ...pins, publicKeySha256: '0'.repeat(64) };
  const result = await evaluate(candidate);
  assert.equal(result.prepared, false);
  assert.ok(result.blockers.includes('reviewed-baseline-changed'));
});

test('absent native pins and disabled null templates refuse preparation', async () => {
  const absent = await evaluate(baseline);
  assert.equal(absent.prepared, false);
  const disabled = JSON.parse(
    readFileSync(
      new URL('./native-staging-push.template.json', import.meta.url),
      'utf8'
    )
  );
  const result = await evaluate({ ...baseline, ...disabled });
  assert.equal(result.prepared, false);
  assert.ok(result.blockers.some((blocker) => blocker.includes('native pins')));
});

test('does not review or inherit a standard EAS profile', async () => {
  for (const fragment of [
    { build: { production: {} } },
    { build: { ...profile().build, development: {} } },
    { ...profile(), submit: {} },
  ]) {
    const result = await evaluate(pins, fragment);
    assert.equal(result.prepared, false);
    assert.ok(result.blockers.includes('isolated-profile-required'));
  }
});

test('rejects cloud profile overrides, production inheritance and a simulator', async () => {
  for (const override of [
    { extends: 'production' },
    { distribution: 'store' },
    { developmentClient: false },
    { environment: 'production' },
    { ios: { simulator: true } },
    { android: { buildType: 'app-bundle' } },
    { autoIncrement: true },
  ]) {
    const fragment = profile();
    Object.assign(fragment.build['hosted-staging-push'], override);
    assert.equal((await evaluate(pins, fragment)).prepared, false);
  }
});

test('rejects missing review marker and unknown environment values with redacted results', async () => {
  for (const mutate of [
    (env) => {
      delete env.BACI_REVIEWED_HOSTED_PUSH_BUILD;
    },
    (env) => {
      env.EXPO_PUBLIC_POSTHOG_API_KEY = 'never-output-secret';
    },
    (env) => {
      env.EAS_BUILD_PROFILE = 'production';
    },
    (env) => {
      env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'never-output-secret';
    },
  ]) {
    const fragment = profile();
    mutate(fragment.build['hosted-staging-push'].env);
    const result = await evaluate(pins, fragment);
    assert.equal(result.prepared, false);
    assert.equal(JSON.stringify(result).includes('never-output-secret'), false);
  }
});

test('preflight CLI is offline, redacted and refuses current missing pins', () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./preflight.mjs', import.meta.url))],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.prepared, false);
  assert.equal(report.buildAuthorized, false);
  assert.equal(report.deviceAcceptanceVerified, false);
  assert.equal(result.stderr, '');
});

test('CLI rejects unknown options and missing files without echoing arguments', () => {
  for (const args of [
    ['--password', 'never-output-secret'],
    ['--pins', '/nonexistent/never-output-secret.json'],
    ['--profile'],
    ['--pins', '--profile'],
  ]) {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('./preflight.mjs', import.meta.url)), ...args],
      { encoding: 'utf8' }
    );
    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stdout).blockers, ['input-invalid']);
    assert.equal(result.stdout.includes('never-output-secret'), false);
    assert.equal(result.stderr, '');
  }
});
