import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitRepository } from './storefront-release-gate.mjs';
import { readJob, readStep } from './storefront-release-gate-workflows.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const repository = gitRepository(ROOT);

test('iOS release reports TestFlight-only, submitted, and slot-occupied outcomes', () => {
  const workflow = repository.readFile('.github/workflows/ios-storefront-release.yml');
  const job = readJob(workflow, 'build-and-submit');
  const submission = readStep(job, 'Submit to App Store for review');
  assert.ok(
    submission.text.includes(
      "if: ${{ !cancelled() && steps.fastlane_release.outcome == 'success' && !(github.event_name == 'workflow_dispatch' && inputs.testflight_only) }}"
    )
  );
  const releaseModeStep = readStep(job, 'Record release mode');
  const summaryScript = join(ROOT, '.github/scripts/record-ios-storefront-release-mode.sh');
  const mode = repository.readFile('.github/scripts/record-ios-storefront-release-mode.sh');
  const fastfile = repository.readFile('apps/mobile-storefront/fastlane/Fastfile');
  const manualWorkflow = repository.readFile('.github/workflows/ios-storefront-submit.yml');
  const manualJob = readJob(manualWorkflow, 'submit');
  const manualSubmission = readStep(manualJob, 'Fastlane submit');
  const manualSummary = readStep(manualJob, 'Record submission mode');

  assert.match(mode, /TESTFLIGHT_ONLY/);
  assert.match(mode, /SUBMISSION_RESULT/);
  assert.match(mode, /SUBMISSION_OUTCOME/);
  const runSummary = ({ outcome, testflightOnly = false, result = '', uploadCompleted = true }) => {
    const directory = mkdtempSync(join(tmpdir(), 'ios-release-summary-'));
    const summaryPath = join(directory, 'summary.md');
    try {
      execFileSync('bash', [summaryScript], {
        env: {
          ...process.env,
          TESTFLIGHT_ONLY: String(testflightOnly),
          TESTFLIGHT_UPLOAD_COMPLETED: String(uploadCompleted),
          SUBMISSION_OUTCOME: outcome,
          SUBMISSION_RESULT: result,
          GITHUB_STEP_SUMMARY: summaryPath,
        },
      });
      return readFileSync(summaryPath, 'utf8');
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  };
  assert.match(runSummary({ outcome: 'failure', testflightOnly: true }), /App Store submission failed/);
  assert.match(runSummary({ outcome: 'cancelled', testflightOnly: true }), /App Store submission was cancelled/);
  assert.match(
    runSummary({ outcome: 'skipped' }),
    /App Store submission did not start/
  );
  assert.match(
    runSummary({ outcome: 'skipped', testflightOnly: true }),
    /TestFlight build only\. App Store submission was intentionally skipped/
  );
  assert.match(
    runSummary({ outcome: 'success', result: 'submitted' }),
    /uploaded the iOS build and submitted it for App Store review/
  );
  assert.match(
    runSummary({ outcome: 'success', result: 'skipped' }),
    /version slot is occupied/
  );
  assert.match(releaseModeStep.text, /TESTFLIGHT_UPLOAD_COMPLETED: 'true'/);
  assert.match(releaseModeStep.run, /record-ios-storefront-release-mode\.sh/);
  assert.match(mode, /intentionally skipped/);
  assert.match(mode, /submitted it for App Store review/);
  assert.match(mode, /version slot is occupied/);
  assert.match(fastfile, /record_github_app_store_submission\("skipped"\)/);
  assert.match(fastfile, /record_github_app_store_submission\("submitted"\)/);
  assert.match(manualSubmission.text, /id: submit/);
  assert.match(manualSummary.text, /steps\.submit\.outcome != 'skipped'/);
  assert.match(manualSummary.text, /steps\.submit\.outputs\.app_store_submission/);
  assert.match(manualSummary.text, /SUBMISSION_OUTCOME: \$\{\{ steps\.submit\.outcome \}\}/);
  assert.match(manualSummary.text, /TESTFLIGHT_UPLOAD_COMPLETED: 'false'/);
  assert.match(manualSummary.run, /record-ios-storefront-release-mode\.sh/);
  assert.equal(
    runSummary({ outcome: 'failure', uploadCompleted: false }).trim(),
    'App Store submission failed. Inspect the Fastlane submit logs.'
  );
  assert.equal(
    runSummary({ outcome: 'success', result: 'submitted', uploadCompleted: false }).trim(),
    'This run submitted the iOS build for App Store review.'
  );
  assert.match(
    runSummary({ outcome: 'success', result: 'skipped', uploadCompleted: false }),
    /^This run skipped App Store submission because the App Store version slot is occupied/
  );
  assert.match(manualWorkflow, /build_number:\n\s+description:.*\n\s+required: true/);
  assert.match(manualWorkflow, /app_version:\n\s+description:.*\n\s+required: true/);
});
