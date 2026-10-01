import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import YAML from 'yaml';

const workflowUrl = new URL('../workflows/deploy.yml', import.meta.url);

test('uses a minimal sparse checkout for VPS drain readiness', async () => {
  const workflow = YAML.parse(await readFile(workflowUrl, 'utf8'));
  const steps = workflow.jobs['vps-drain-readiness'].steps;
  const checkout = steps.find((step) => typeof step.uses === 'string');
  const verification = steps.find(
    (step) => step.name === 'Verify production cache-invalidation drain installation'
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
      'vps-workers/bin/verify-gigl-direct-workers-installed.sh\n'
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
  // Signal, not gate: no changeset condition, never fails (fail-closed
  // latched=false), so tracking pushes proceed to their own smoke.
  assert.equal(latchCheck.if, undefined);
  assert.match(latchCheck.run, /\.gigl-capability-smoke-ok/);
  assert.match(latchCheck.run, /latched=false/);
  assert.match(latchCheck.run, /\$GITHUB_OUTPUT/);
});

test('persists the cutover latch only after the smoke succeeds', async () => {
  const workflow = YAML.parse(await readFile(workflowUrl, 'utf8'));
  const capability = workflow.jobs['gigl-worker-capability'];
  const steps = capability.steps;
  const smokeIndex = steps.findIndex(
    (step) => step.name === 'Smoke the live GIGL wrapper capability'
  );
  const persistIndex = steps.findIndex(
    (step) => step.name === 'Persist GIGL cutover latch'
  );

  assert.ok(smokeIndex >= 0, 'missing capability smoke step');
  assert.ok(
    persistIndex > smokeIndex,
    'latch must persist after the smoke succeeds'
  );
  // No `if`: same-job sequencing means this step runs if and only if the
  // smoke step succeeded.
  assert.equal(steps[persistIndex].if, undefined);
  assert.match(
    steps[persistIndex].run,
    /\.gigl-capability-smoke-ok/
  );
});
