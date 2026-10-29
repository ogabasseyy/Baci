import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

const require = createRequire(path.join(process.cwd(), 'package.json'));
const { parse } = require('yaml');

test('OTA export uses the same public values as the iOS native release', async () => {
  const release = parse(await readFile('.github/workflows/ios-storefront-release.yml', 'utf8'));
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
  assert.ok(nativeStep?.env, 'Native Fastlane release environment is missing');
  assert.ok(otaStep?.env, 'OTA export environment is missing');
  assert.match(selection?.run ?? '', /git grep -q -F 'process\.env\.EXPO_PUBLIC_BUILD_SHA'/);
  const nativeEnv = nativeStep.env;
  const otaEnv = otaStep.env;
  assert.ok(!Object.hasOwn(otaEnv, 'STOREFRONT_TIKTOK_APP_SECRET'));
  for (const [name, value] of Object.entries(nativeEnv)) {
    if (name.startsWith('EXPO_PUBLIC_') || name.startsWith('STOREFRONT_')) {
      assert.equal(otaEnv[name], value, `OTA production value differs for ${name}`);
    }
  }
});
