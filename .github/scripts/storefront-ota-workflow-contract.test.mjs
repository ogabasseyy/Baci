import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

const require = createRequire(path.join(process.cwd(), 'package.json'));
const { parse } = require('yaml');

function effectiveEnvironment(workflowEnv, jobEnv, stepEnv) {
  return { ...workflowEnv, ...jobEnv, ...stepEnv };
}

function assertEnvironmentParity(nativeEnv, otaEnv) {
  // The OTA embeds its reviewed source SHA; the native build embeds its own SHA.
  assert.equal(nativeEnv.EXPO_PUBLIC_BUILD_SHA, '${{ github.sha }}');
  assert.equal(otaEnv.EXPO_PUBLIC_BUILD_SHA, '${{ inputs.source_sha }}');
  // TikTok's build-only secret must never enter the public OTA export.
  assert.ok(!Object.hasOwn(otaEnv, 'STOREFRONT_TIKTOK_APP_SECRET'));
  const exceptions = new Set(['EXPO_PUBLIC_BUILD_SHA', 'STOREFRONT_TIKTOK_APP_SECRET']);
  for (const [name, value] of Object.entries(nativeEnv)) {
    if ((name.startsWith('EXPO_PUBLIC_') || name.startsWith('STOREFRONT_')) && !exceptions.has(name)) {
      assert.equal(otaEnv[name], value, `OTA production value differs for ${name}`);
    }
  }
  for (const name of Object.keys(otaEnv)) {
    if ((name.startsWith('EXPO_PUBLIC_') || name.startsWith('STOREFRONT_')) && !exceptions.has(name)) {
      assert.ok(Object.hasOwn(nativeEnv, name), `OTA sets ${name}, which the native release does not set`);
    }
  }
}

test('effective step environment honors workflow, job and step precedence', () => {
  assert.deepEqual(
    effectiveEnvironment(
      { VALUE: 'workflow', WORKFLOW_ONLY: 'yes' },
      { VALUE: 'job', JOB_ONLY: 'yes' },
      { VALUE: 'step', STEP_ONLY: 'yes' }
    ),
    { VALUE: 'step', WORKFLOW_ONLY: 'yes', JOB_ONLY: 'yes', STEP_ONLY: 'yes' }
  );
});

test('environment parity allows only the documented OTA omissions', () => {
  const native = {
    EXPO_PUBLIC_BUILD_SHA: '${{ github.sha }}',
    EXPO_PUBLIC_VALUE: 'same',
    STOREFRONT_TIKTOK_APP_SECRET: '${{ secrets.STOREFRONT_TIKTOK_APP_SECRET }}',
  };
  const ota = {
    EXPO_PUBLIC_BUILD_SHA: '${{ inputs.source_sha }}',
    EXPO_PUBLIC_VALUE: 'same',
  };
  assert.doesNotThrow(() => assertEnvironmentParity(native, ota));
  assert.throws(() => assertEnvironmentParity(native, { ...ota, EXPO_PUBLIC_VALUE: 'changed' }));
  assert.throws(() => assertEnvironmentParity(native, { ...ota, EXPO_PUBLIC_EXTRA: 'new' }));
  assert.throws(() => assertEnvironmentParity(native, { ...ota, STOREFRONT_TIKTOK_APP_SECRET: 'exposed' }));
  assert.throws(() => assertEnvironmentParity(native, { ...ota, EXPO_PUBLIC_BUILD_SHA: 'wrong' }));
});

test('OTA export uses the same public values as the iOS native release', async () => {
  const releasePath = process.env.BACI_NATIVE_RELEASE_WORKFLOW_PATH ?? '.github/workflows/ios-storefront-release.yml';
  const release = parse(await readFile(releasePath, 'utf8'));
  const exportPath = process.env.BACI_OTA_WORKFLOW_PATH ?? '.github/workflows/storefront-ota-export.yml';
  const ota = parse(await readFile(exportPath, 'utf8'));
  const selection = ota.jobs.export.steps.find(
    (step) => step.name === 'Validate and select reviewed source'
  );
  const nativeStep = release.jobs['build-and-submit'].steps.find(
    (step) => step.name === 'Fastlane release'
  );
  const otaStep = ota.jobs.export.steps.find(
    (step) => step.name === 'Export with native release settings'
  );
  const parityStep = ota.jobs.export.steps.find(
    (step) => step.name === 'Verify public environment parity with the current native release workflow'
  );
  assert.ok(nativeStep?.env, 'Native Fastlane release environment is missing');
  assert.ok(otaStep?.env, 'OTA export environment is missing');
  assert.match(selection?.run ?? '', /git grep -q -F 'process\.env\.EXPO_PUBLIC_BUILD_SHA'/);
  assert.match(selection?.run ?? '', /cp \.github\/scripts\/storefront-ota-constants\.mjs "\$RUNNER_TEMP\/"/);
  assert.match(selection?.run ?? '', /cp \.github\/workflows\/ios-storefront-release\.yml "\$RUNNER_TEMP\/"/);
  assert.equal(parityStep?.env?.BACI_NATIVE_RELEASE_WORKFLOW_PATH, '${{ runner.temp }}/ios-storefront-release.yml');
  const nativeEnv = effectiveEnvironment(release.env, release.jobs['build-and-submit'].env, nativeStep.env);
  const otaEnv = effectiveEnvironment(ota.env, ota.jobs.export.env, otaStep.env);
  assertEnvironmentParity(nativeEnv, otaEnv);
});
