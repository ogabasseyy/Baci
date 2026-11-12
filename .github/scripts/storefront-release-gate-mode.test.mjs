import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gitRepository } from './storefront-release-gate.mjs';
import { readJob, readStep } from './storefront-release-gate-workflows.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const repository = gitRepository(ROOT);

test('iOS release reports TestFlight-only, submitted, and slot-occupied outcomes', () => {
  const workflow = repository.readFile('.github/workflows/ios-storefront-release.yml');
  const job = readJob(workflow, 'build-and-submit');
  const mode = readStep(job, 'Record release mode').text;
  const fastfile = repository.readFile('apps/mobile-storefront/fastlane/Fastfile');

  assert.match(mode, /TESTFLIGHT_ONLY/);
  assert.match(mode, /SUBMISSION_RESULT/);
  assert.match(mode, /intentionally skipped/);
  assert.match(mode, /submitted it for App Store review/);
  assert.match(mode, /version slot is occupied/);
  assert.match(fastfile, /record_github_app_store_submission\("skipped"\)/);
  assert.match(fastfile, /record_github_app_store_submission\("submitted"\)/);
});
