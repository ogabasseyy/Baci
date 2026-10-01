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
});
