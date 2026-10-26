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
    .replace(`        timeout-minutes: ${buildBudget}\n`, '')
    .replace(
      '      - name: Upload AAB artifact',
      '      - uses: actions/fixture@v1\n        timeout-minutes: 210\n      - name: Upload AAB artifact',
    );
  assert.ok(Number.isNaN(readBudgets(fixture).buildBudget));
});

test('cold native compilation and app packaging have independent budgets', () => {
  const nativeStep =
    workflow
      .split('      - name: Compile patched React Native and Hermes')[1]
      ?.split(/\n {6}- /)[0] ?? '';
  const nativeBudget = Number(
    nativeStep.match(/^ {8}timeout-minutes: (\d+)$/m)?.[1],
  );
  assert.equal(nativeBudget, 360);
  assert.ok(buildBudget >= 180 && buildBudget <= 360);
  assert.ok(jobBudget >= nativeBudget + buildBudget + 30);
  assert.ok(
    workflow.indexOf('      - name: Compile patched React Native and Hermes') <
      workflow.indexOf('      - name: Decode keystore'),
  );
  assert.match(nativeStep, /android-storefront-release\.sh" build-native/);
  assert.doesNotMatch(nativeStep, /KEYSTORE|KEY_PASSWORD|SENTRY_AUTH_TOKEN/);
  assert.match(workflow, /runs-on: baci-android/);
});

test('configures runner-owned Gradle storage before setup-gradle', () => {
  const privateHome = workflow.indexOf(
    '      - name: Configure dedicated Gradle home',
  );
  const setupGradle = workflow.indexOf('      - name: Setup Gradle');
  assert.ok(privateHome >= 0 && privateHome < setupGradle);
  assert.match(
    workflow,
    /android-storefront-release\.sh" configure-gradle-home/,
  );
});
