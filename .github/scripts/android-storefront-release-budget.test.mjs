import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = readFileSync(
  new URL('../workflows/android-storefront-release.yml', import.meta.url),
  'utf8',
);
function readBudgets(contents) {
  const releaseJob =
    contents
      .split(/^ {2}build-and-deploy:\s*$/m)[1]
      ?.split(/^ {2}[\w-]+:\s*$/m)[0] ?? '';
  const jobBudget = Number(
    releaseJob.match(/^ {4}timeout-minutes: (\d+)$/m)?.[1],
  );
  const buildStep = releaseJob
    .split('      - name: Build Android App Bundle (storefront)')[1]
    ?.split(/\n {6}- /)[0];
  const buildBudget = Number(
    buildStep?.match(/^ {8}timeout-minutes: (\d+)$/m)?.[1],
  );
  return { jobBudget, buildBudget };
}

const { jobBudget, buildBudget } = readBudgets(workflow);

test('ignores timeout budgets in unrelated jobs before and after the release job', () => {
  const withOtherJobs = `${workflow.replace(
    '  build-and-deploy:',
    '  lint:\n    timeout-minutes: 5\n  build-and-deploy:',
  )}\n  after-release:\n    timeout-minutes: 7\n`;
  assert.deepEqual(readBudgets(withOtherJobs), readBudgets(workflow));
});

test('does not borrow a build timeout from a different job', () => {
  const fixture =
    'jobs:\n  build-and-deploy:\n    timeout-minutes: 240\n  other:\n      - name: Build Android App Bundle (storefront)\n        timeout-minutes: 210\n';
  assert.ok(Number.isNaN(readBudgets(fixture).buildBudget));
});

test('does not borrow a timeout from an unnamed following step', () => {
  const fixture = workflow
    .replace('        timeout-minutes: 210\n', '')
    .replace(
      '      - name: Upload AAB artifact',
      '      - uses: actions/fixture@v1\n        timeout-minutes: 210\n      - name: Upload AAB artifact',
    );
  assert.ok(Number.isNaN(readBudgets(fixture).buildBudget));
});

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
