import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = readFileSync(
  new URL('../workflows/android-storefront-release.yml', import.meta.url),
  'utf8',
);
const jobBudget = Number(workflow.match(/^ {4}timeout-minutes: (\d+)$/m)?.[1]);
const buildStep = workflow
  .split('      - name: Build Android App Bundle (storefront)')[1]
  ?.split('\n      - name:')[0];
const buildBudget = Number(
  buildStep?.match(/^ {8}timeout-minutes: (\d+)$/m)?.[1],
);

test('source-built Android release has time for all ABIs plus publication and cleanup', () => {
  // The four-ABI ReactAndroid/Hermes cold build exceeded the old 90-minute job.
  assert.ok(jobBudget >= 240, 'cold native builds need a four-hour job window');
  assert.ok(
    buildBudget >= 180,
    'the native build step needs at least three hours',
  );
  assert.ok(
    jobBudget - buildBudget >= 30,
    'reserve at least 30 minutes for setup, Play upload and cleanup',
  );
  assert.match(workflow, /runs-on: baci-android/);
});
