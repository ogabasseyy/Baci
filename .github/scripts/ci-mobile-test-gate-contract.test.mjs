import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import YAML from 'yaml';

import { resolveNonWebTestFilterArgs } from './resolve-ci-non-web-test-filters.mjs';
import { resolveCiTestPlan } from './resolve-ci-test-plan.mjs';

// A pull request that changed only apps/mobile-admin or apps/mobile-storefront
// ran no unit tests: `quality-test` required `web == 'true'`, and the aggregate
// accepted the skip (seen on PR 4487).

const workflow = YAML.parse(
  await readFile('.github/workflows/ci.yml', 'utf8')
);
const job = workflow.jobs['quality-test'];

const NO_CHANGES = {
  web: 'false',
  mobile_admin: 'false',
  mobile_storefront: 'false',
  quiz_db: 'false',
  test_plan_mode: 'full-affected',
  stage: 'full',
};
const MOBILE_FLAGS = ['mobile_admin', 'mobile_storefront'];

// Expressions limited to `needs.changes.outputs.*`, `steps.test-plan.outputs.mode`,
// quoted strings, ==, !=, &&, || and parentheses are also valid JavaScript.
function evaluate(condition, outputs) {
  const source = String(condition)
    .replace(/needs\.changes\.outputs\.(\w+)/g, (_match, name) =>
      JSON.stringify(outputs[name] ?? '')
    )
    .replace(/steps\.test-plan\.outputs\.mode/g, () =>
      JSON.stringify(outputs.test_plan_mode)
    );
  assert.match(source, /^[\s()'"\w=!&|-]+$/, `unexpected: ${condition}`);
  return Function(`"use strict"; return (${source});`)();
}

const step = (name) => {
  const found = job.steps.find((candidate) => candidate.name === name);
  assert.ok(found, `quality-test is missing the "${name}" step`);
  return found;
};

function runAggregate({ testResult, outputs }) {
  const verify = workflow.jobs.quality.steps.find(
    (candidate) => candidate.name === 'Verify split quality gate results'
  );
  const results = Object.fromEntries(
    Object.keys(verify.env)
      .filter((name) => name.endsWith('_RESULT'))
      .map((name) => [name, 'success'])
  );
  return spawnSync('bash', ['.github/scripts/verify-quality-gate.sh'], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      ...results,
      TEST_RESULT: testResult,
      QUIZ_DB_CHANGED: outputs.quiz_db,
      WEB_CHANGED: outputs.web,
      MOBILE_ADMIN_CHANGED: outputs.mobile_admin,
      MOBILE_STOREFRONT_CHANGED: outputs.mobile_storefront,
      TEST_PLAN_MODE: outputs.test_plan_mode,
    },
  });
}

test('runs the unit test job for a change to only one mobile app', () => {
  for (const flag of ['web', ...MOBILE_FLAGS]) {
    const outputs = { ...NO_CHANGES, [flag]: 'true' };
    assert.equal(evaluate(job.if, outputs), true, `${flag} must run tests`);
    // Review-first CI still defers the job until the full stage.
    assert.equal(evaluate(job.if, { ...outputs, stage: 'quick' }), false);
  }
  assert.equal(evaluate(job.if, NO_CHANGES), false);
});

test('keeps the web shards and web-only steps out of a mobile-only run', () => {
  const experience = step('Run portable experience runner units');
  const recovery = step('Verify authenticated shipping recovery in PostgreSQL');
  for (const flag of MOBILE_FLAGS) {
    const outputs = { ...NO_CHANGES, [flag]: 'true' };
    assert.equal(
      evaluate(workflow.jobs['quality-test-web'].if, outputs),
      false
    );
    assert.equal(evaluate(experience.if, outputs), false);
    assert.equal(evaluate(recovery.if, outputs), false);
  }
  const web = { ...NO_CHANGES, web: 'true' };
  assert.equal(evaluate(experience.if, web), true);
  assert.equal(evaluate(recovery.if, web), true);
  // The test step itself must never be limited to web changes.
  assert.equal(step('Run Tests').if, undefined);
});

test('selects the affected mobile tests for a mobile-only pull request', () => {
  const plan = resolveCiTestPlan({
    baseRef: 'origin/main',
    changedFiles: ['apps/mobile-admin/fastlane/Fastfile'],
    eventName: 'pull_request',
  });
  assert.equal(plan.mode, 'full-affected');
  assert.match(step('Run Tests').run, /run-ci-non-web-tests\.mjs/);
  assert.deepEqual(
    resolveNonWebTestFilterArgs({
      baseRef: 'origin/main',
      eventName: 'pull_request',
    }),
    ['--filter=...[origin/main]', '--filter=!@baci/web']
  );
});

test('fails the Quality Gate when tests are skipped for changed code', () => {
  for (const flag of ['web', ...MOBILE_FLAGS]) {
    for (const mode of ['full-affected', 'config-smoke']) {
      const result = runAggregate({
        testResult: 'skipped',
        outputs: { ...NO_CHANGES, [flag]: 'true', test_plan_mode: mode },
      });
      assert.equal(result.status, 1, `${flag} ${mode}: ${result.stdout}`);
      assert.match(result.stdout, /test gate was skipped/);
    }
  }
});

test('reports the mobile test result and accepts a skip with nothing changed', () => {
  const outputs = { ...NO_CHANGES, mobile_admin: 'true' };
  assert.equal(runAggregate({ testResult: 'success', outputs }).status, 0);
  for (const testResult of ['failure', 'cancelled']) {
    assert.equal(runAggregate({ testResult, outputs }).status, 1, testResult);
  }
  assert.equal(
    runAggregate({ testResult: 'skipped', outputs: NO_CHANGES }).status,
    0
  );
});

test('stays wired into the CI contract run', async () => {
  const entrypoint = await readFile(
    '.github/scripts/resolve-ci-test-plan-config.test.mjs',
    'utf8'
  );
  const filters = YAML.parse(await readFile('.github/filters/ci.yml', 'utf8'));

  assert.ok(
    entrypoint.includes("import './ci-mobile-test-gate-contract.test.mjs';")
  );
  assert.ok(
    filters.web.includes(
      '.github/scripts/ci-mobile-test-gate-contract.test.mjs'
    )
  );
});
