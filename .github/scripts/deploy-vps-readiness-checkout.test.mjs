import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import YAML from 'yaml';

const workflowUrl = new URL('../workflows/deploy.yml', import.meta.url);

test('validates publication tooling and safety before building and again before publishing', async () => {
  const workflow = YAML.parse(await readFile(workflowUrl, 'utf8'));
  const steps = workflow.jobs['deploy-production'].steps;
  const buildIndex = steps.findIndex(step => step.name === 'Build for Vercel');
  const publishIndex = steps.findIndex(step => step.name === 'Deploy to Vercel (with retry)');
  const checks = steps.map((step, index) => ({ step, index })).filter(({ step }) => step.run === '.github/scripts/refuse-publish-on-promote-overlap.sh');
  assert.equal(checks.length, 2);
  assert.ok(checks[0].index < buildIndex);
  assert.ok(checks[1].index > buildIndex && checks[1].index < publishIndex);
  for (const { step } of checks) {
    assert.equal(step.env.GH_TOKEN, '${{ github.token }}');
    assert.equal(step['continue-on-error'], undefined);
  }
});

test('uses a minimal sparse checkout for VPS drain readiness', async () => {
  const workflow = YAML.parse(await readFile(workflowUrl, 'utf8'));
  const steps = workflow.jobs['vps-drain-readiness'].steps;
  const checkout = steps.find((step) => typeof step.uses === 'string');
  const verification = steps.find(
    (step) =>
      step.name === 'Verify production cache-invalidation drain installation'
  );
  const giglVerification = steps.find(
    (step) => step.name === 'Verify production GIGL direct-worker installation'
  );
  const cutoverMarker = steps.find(
    (step) => step.name === 'Verify GIGL tracking cutover marker'
  );

  assert.equal(checkout.with.path, '.readiness-checkout');
  assert.equal(
    checkout.with['sparse-checkout'],
    'vps-workers/bin/verify-cache-invalidation-drain-installed.sh\n' +
      'vps-workers/bin/verify-gigl-direct-workers-installed.sh\n' +
      '.github/scripts/check-gigl-cutover-latch.sh\n' +
      '.github/scripts/resolve-gigl-latch-identity.sh\n' +
      '.github/scripts/gigl-dotenv.sh\n' +
      '.github/scripts/verify-coordinated-release.sh\n' +
      '.github/filters/deploy.yml\n'
  );
  assert.equal(checkout.with['sparse-checkout-cone-mode'], false);
  assert.equal(
    verification.run,
    '.readiness-checkout/vps-workers/bin/verify-cache-invalidation-drain-installed.sh'
  );
  assert.equal(
    giglVerification.run,
    '.readiness-checkout/vps-workers/bin/verify-gigl-direct-workers-installed.sh --skip-live-smoke'
  );
  assert.equal(
    giglVerification.if,
    "needs.changes.outputs.tracking != 'false'"
  );
  // The cutover marker runs on every main push with no changeset
  // condition: diff-scoped gates alone would let an unrelated web push
  // deploy the cron removal while the worker was never installed.
  assert.equal(
    cutoverMarker.run,
    '.readiness-checkout/vps-workers/bin/verify-gigl-direct-workers-installed.sh --cutover-marker'
  );
  assert.equal(cutoverMarker.if, undefined);
});

test('reports the cutover latch as a readiness output signal', async () => {
  const workflow = YAML.parse(await readFile(workflowUrl, 'utf8'));
  const readiness = workflow.jobs['vps-drain-readiness'];
  const latchCheck = readiness.steps.find(
    (step) => step.name === 'Check GIGL cutover latch'
  );

  assert.equal(
    readiness.outputs.cutover_latched,
    '${{ steps.gigl-cutover-latch.outputs.latched }}'
  );
  assert.equal(
    readiness.outputs.tracking_stale,
    '${{ steps.gigl-cutover-latch.outputs.tracking_stale }}'
  );
  assert.equal(
    readiness.outputs.manifest_drift,
    '${{ steps.gigl-cutover-latch.outputs.manifest_drift }}'
  );
  assert.equal(
    readiness.outputs.installed_sha,
    '${{ steps.gigl-cutover-latch.outputs.installed_sha }}'
  );
  assert.equal(
    readiness.outputs.installed_tracking_stale,
    '${{ steps.gigl-cutover-latch.outputs.installed_tracking_stale }}'
  );
  // Signal, not gate: no changeset condition, never fails (fail-closed
  // latched=false / stale=true), so tracking pushes proceed to their own
  // smoke. The script diffs the latched revision against HEAD over the
  // tracking filter; the token is read-scoped fetch auth only.
  assert.equal(latchCheck.if, undefined);
  assert.equal(
    latchCheck.run,
    '.readiness-checkout/.github/scripts/check-gigl-cutover-latch.sh "$VPS_WORKER_REMOTE_DIR" .readiness-checkout'
  );
  assert.equal(latchCheck.env.GITHUB_TOKEN, '${{ github.token }}');
});

test('delegates verification, smoke and latch persistence to one locked helper', async () => {
  const workflow = YAML.parse(await readFile(workflowUrl, 'utf8'));
  const capability = workflow.jobs['gigl-worker-capability'];
  const refreshSteps = capability.steps.filter(
    (step) => step.run === 'bash .github/scripts/refresh-gigl-cutover-latch.sh'
  );

  assert.equal(refreshSteps.length, 1);
  assert.equal(refreshSteps[0].if, undefined);
  assert.equal(refreshSteps[0]['continue-on-error'], undefined);
  assert.equal(capability['continue-on-error'], undefined);
  assert.equal(capability.env.GIGL_ENV_FILE_AUTHORITATIVE, '1');
  assert.equal(typeof refreshSteps[0].env.BACI_EXPECTED_APP_SHA, 'string');
  assert.equal(
    capability.steps.some((step) =>
      step.run?.includes('> "$VPS_WORKER_REMOTE_DIR/.gigl-capability-smoke-ok"')
    ),
    false,
    'the workflow must not write an unlocked latch outside the helper'
  );
});
