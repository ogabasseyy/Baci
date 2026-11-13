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
  const mode = releaseModeStep.text;
  const fastfile = repository.readFile('apps/mobile-storefront/fastlane/Fastfile');
  const manualWorkflow = repository.readFile('.github/workflows/ios-storefront-submit.yml');
  const manualJob = readJob(manualWorkflow, 'submit');
  const manualSubmission = readStep(manualJob, 'Fastlane submit');
  const manualSummary = readStep(manualJob, 'Record submission mode');

  assert.match(mode, /TESTFLIGHT_ONLY/);
  assert.match(mode, /SUBMISSION_RESULT/);
  assert.match(mode, /SUBMISSION_OUTCOME/);
  const runSummary = ({ outcome, testflightOnly = false, result = '' }) => {
    const directory = mkdtempSync(join(tmpdir(), 'ios-release-summary-'));
    const summaryPath = join(directory, 'summary.md');
    try {
      execFileSync('bash', ['-c', releaseModeStep.run], {
        env: {
          ...process.env,
          TESTFLIGHT_ONLY: String(testflightOnly),
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
  assert.match(runSummary({ outcome: 'failure' }), /App Store submission failed/);
  assert.match(runSummary({ outcome: 'cancelled' }), /App Store submission was cancelled/);
  assert.match(
    runSummary({ outcome: 'success', testflightOnly: true }),
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
  assert.match(mode, /intentionally skipped/);
  assert.match(mode, /submitted it for App Store review/);
  assert.match(mode, /version slot is occupied/);
  assert.match(fastfile, /record_github_app_store_submission\("skipped"\)/);
  assert.match(fastfile, /record_github_app_store_submission\("submitted"\)/);
  assert.match(manualSubmission.text, /id: submit/);
  assert.match(manualSummary.text, /steps\.submit\.outcome != 'skipped'/);
  assert.match(manualSummary.text, /steps\.submit\.outputs\.app_store_submission/);
  assert.match(manualSummary.text, /SUBMISSION_OUTCOME: \$\{\{ steps\.submit\.outcome \}\}/);
  assert.match(manualSummary.run, /submitted the iOS build for App Store review/);
  assert.match(manualSummary.run, /skipped App Store submission because the App Store version slot is occupied/);
  assert.match(manualSummary.run, /Fastlane completed without recording/);
  const runManualSummary = (outcome) => {
    const directory = mkdtempSync(join(tmpdir(), 'ios-submit-summary-'));
    const summaryPath = join(directory, 'summary.md');
    try {
      execFileSync('bash', ['-c', manualSummary.run], {
        env: {
          ...process.env,
          SUBMISSION_OUTCOME: outcome,
          SUBMISSION_RESULT: '',
          GITHUB_STEP_SUMMARY: summaryPath,
        },
      });
      return readFileSync(summaryPath, 'utf8');
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  };
  assert.match(runManualSummary('failure'), /App Store submission failed/);
  assert.match(runManualSummary('cancelled'), /App Store submission was cancelled/);
  assert.match(manualWorkflow, /build_number:\n\s+description:.*\n\s+required: true/);
  assert.match(manualWorkflow, /app_version:\n\s+description:.*\n\s+required: true/);
});
