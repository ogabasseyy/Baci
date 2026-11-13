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
  const submission = readStep(job, 'Submit to App Store for review');
  assert.match(
    submission.text,
    /if:.*!cancelled\(\).*steps\.fastlane_release\.outcome == 'success'.*\&\& !\(github\.event_name == 'workflow_dispatch' && inputs\.testflight_only\)/s
  );
  const mode = readStep(job, 'Record release mode').text;
  const fastfile = repository.readFile('apps/mobile-storefront/fastlane/Fastfile');
  const manualWorkflow = repository.readFile('.github/workflows/ios-storefront-submit.yml');
  const manualJob = readJob(manualWorkflow, 'submit');
  const manualSubmission = readStep(manualJob, 'Fastlane submit');
  const manualSummary = readStep(manualJob, 'Record submission mode');

  assert.match(mode, /TESTFLIGHT_ONLY/);
  assert.match(mode, /SUBMISSION_RESULT/);
  assert.match(mode, /intentionally skipped/);
  assert.match(mode, /submitted it for App Store review/);
  assert.match(mode, /version slot is occupied/);
  assert.match(fastfile, /record_github_app_store_submission\("skipped"\)/);
  assert.match(fastfile, /record_github_app_store_submission\("submitted"\)/);
  assert.match(manualSubmission.text, /id: submit/);
  assert.match(manualSummary.text, /steps\.submit\.outputs\.app_store_submission/);
  assert.match(manualSummary.run, /submitted the iOS build for App Store review/);
  assert.match(manualSummary.run, /skipped App Store submission because the App Store version slot is occupied/);
  assert.match(manualSummary.run, /Fastlane completed without recording/);
  assert.match(manualWorkflow, /build_number:\n\s+description:.*\n\s+required: true/);
  assert.match(manualWorkflow, /app_version:\n\s+description:.*\n\s+required: true/);
});
