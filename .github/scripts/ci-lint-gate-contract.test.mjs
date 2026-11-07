import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { matchesGlob } from 'node:path';
import test from 'node:test';

import YAML from 'yaml';

const workflow = YAML.parse(
  await readFile('.github/workflows/ci.yml', 'utf8')
);

const filters = YAML.parse(await readFile('.github/filters/ci.yml', 'utf8'));

const NO_CHANGES = {
  web: 'false',
  mobile_admin: 'false',
  mobile_storefront: 'false',
  quiz_db: 'false',
  test_plan_mode: 'targeted',
};

function lintRunner({ isPrivate, enabled, event, headRepository, repository }) {
  const expression = workflow.jobs['quality-lint']['runs-on'];
  assert.match(expression, /^\$\{\{[\s\S]+\}\}$/);
  const values = {
    'github.event.repository.private': isPrivate,
    'vars.BACI_PRIVATE_CI_ENABLED': enabled,
    'github.event_name': event,
    'github.event.pull_request.head.repo.full_name': headRepository,
    'github.repository': repository,
  };
  let source = expression.slice(3, -2);
  for (const [key, value] of Object.entries(values)) {
    const identifier = new RegExp(`${key.replaceAll('.', '\\.')}(?![\\w.])`, 'g');
    source = source.replace(identifier, JSON.stringify(value));
  }
  source = source.replace(/fromJSON\('([^']+)'\)/g, (_match, json) =>
    JSON.stringify(JSON.parse(json))
  );
  assert.match(source, /^[\s()'"\w=!&|,.[\]\/\-]+$/);
  return Function(`"use strict"; return (${source});`)();
}

test('routes lint to the private runner only for an opted-in private repository and trusted PR head', () => {
  const trusted = {
    isPrivate: true,
    enabled: 'true',
    event: 'pull_request',
    headRepository: 'owner/repo',
    repository: 'owner/repo',
  };
  const privateRunner = ['self-hosted', 'Linux', 'X64', 'baci-private-ci'];
  assert.deepEqual(lintRunner(trusted), privateRunner);
  assert.equal(lintRunner({ ...trusted, isPrivate: false }), 'ubuntu-24.04');
  assert.equal(lintRunner({ ...trusted, isPrivate: null }), 'ubuntu-24.04');
  assert.equal(lintRunner({ ...trusted, enabled: '' }), 'ubuntu-24.04');
  assert.equal(lintRunner({ ...trusted, enabled: 'false' }), 'ubuntu-24.04');
  assert.equal(lintRunner({ ...trusted, headRepository: 'other/fork' }), 'ubuntu-24.04');
  assert.equal(lintRunner({ ...trusted, headRepository: '' }), 'ubuntu-24.04');
  assert.equal(lintRunner({ ...trusted, event: 'merge_group', headRepository: '' }), 'ubuntu-24.04');
  for (const event of ['push', 'workflow_dispatch']) {
    assert.deepEqual(lintRunner({ ...trusted, event, headRepository: '' }), privateRunner);
  }
});

test('lint job does not reference secrets', () => {
  assert.doesNotMatch(JSON.stringify(workflow.jobs['quality-lint']), /\bsecrets\s*(?:\.|\[)/);
});

// GitHub expressions limited to `needs.changes.outputs.*`, quoted strings,
// ==, !=, &&, || and parentheses are also valid JavaScript.
function evaluateJobCondition(condition, outputs) {
  const source = condition.replace(
    /needs\.changes\.outputs\.(\w+)/g,
    (_match, name) => JSON.stringify(outputs[name] ?? '')
  );
  assert.match(source, /^[\s()'"\w=!&|-]+$/, `unexpected expression: ${condition}`);
  return Function(`"use strict"; return (${source});`)();
}

function runAggregator({ lintResult, outputs }) {
  const step = workflow.jobs.quality.steps.find(
    (candidate) => candidate.name === 'Verify split quality gate results'
  );
  const results = Object.fromEntries(
    Object.keys(step.env)
      .filter((name) => name.endsWith('_RESULT'))
      .map((name) => [name, 'success'])
  );
  return spawnSync('bash', ['-c', step.run], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      ...results,
      LINT_RESULT: lintResult,
      QUIZ_DB_CHANGED: outputs.quiz_db,
      WEB_CHANGED: outputs.web,
      MOBILE_ADMIN_CHANGED: outputs.mobile_admin,
      MOBILE_STOREFRONT_CHANGED: outputs.mobile_storefront,
      TEST_PLAN_MODE: outputs.test_plan_mode,
    },
  });
}

test('runs lint for web, mobile-admin-only, and mobile-storefront-only changes', () => {
  const condition = workflow.jobs['quality-lint'].if;

  for (const flag of ['web', 'mobile_admin', 'mobile_storefront']) {
    assert.equal(
      evaluateJobCondition(condition, { ...NO_CHANGES, [flag]: 'true' }),
      true,
      `${flag} changes must run lint`
    );
  }
  assert.equal(evaluateJobCondition(condition, NO_CHANGES), false);
  assert.equal(
    evaluateJobCondition(condition, {
      ...NO_CHANGES,
      mobile_admin: 'true',
      test_plan_mode: 'config-smoke',
    }),
    false
  );
});

test('passes the lint result and change flags to the Quality Gate aggregator', () => {
  const step = workflow.jobs.quality.steps.find(
    (candidate) => candidate.name === 'Verify split quality gate results'
  );

  assert.ok(workflow.jobs.quality.needs.includes('quality-lint'));
  assert.equal(step.env.LINT_RESULT, "${{ needs['quality-lint'].result }}");
  assert.equal(step.env.WEB_CHANGED, '${{ needs.changes.outputs.web }}');
  assert.equal(
    step.env.MOBILE_ADMIN_CHANGED,
    '${{ needs.changes.outputs.mobile_admin }}'
  );
  assert.equal(
    step.env.MOBILE_STOREFRONT_CHANGED,
    '${{ needs.changes.outputs.mobile_storefront }}'
  );
});

test('fails the Quality Gate when lint is skipped for lintable changes', () => {
  for (const flag of ['web', 'mobile_admin', 'mobile_storefront']) {
    const result = runAggregator({
      lintResult: 'skipped',
      outputs: { ...NO_CHANGES, [flag]: 'true' },
    });
    assert.equal(result.status, 1, `${flag}: ${result.stdout}`);
    assert.match(result.stdout, /lint gate was skipped/);
  }
});

test('accepts a skipped lint when nothing lintable changed or in config-smoke mode', () => {
  assert.equal(
    runAggregator({ lintResult: 'skipped', outputs: NO_CHANGES }).status,
    0
  );
  assert.equal(
    runAggregator({
      lintResult: 'skipped',
      outputs: { ...NO_CHANGES, mobile_admin: 'true', test_plan_mode: 'config-smoke' },
    }).status,
    0
  );
  assert.equal(
    runAggregator({
      lintResult: 'success',
      outputs: { ...NO_CHANGES, mobile_admin: 'true' },
    }).status,
    0
  );
});

test('flags every lintable mobile path, not only the enumerated app folders', () => {
  const cases = {
    mobile_admin: [
      'apps/mobile-admin/index.ts',
      'apps/mobile-admin/types/order.ts',
      'apps/mobile-admin/__tests__/admin/transactions.test.tsx',
    ],
    mobile_storefront: [
      'apps/mobile-storefront/index.js',
      'apps/mobile-storefront/metro.config.js',
      'apps/mobile-storefront/types/product.ts',
      'apps/mobile-storefront/modules/example/index.ts',
      'apps/mobile-storefront/__tests__/example.test.tsx',
      'apps/mobile-storefront/test-support/render.tsx',
    ],
  };

  for (const [flag, files] of Object.entries(cases)) {
    for (const file of files) {
      assert.ok(
        filters[flag].some((pattern) => matchesGlob(file, pattern)),
        `${file} must set ${flag}`
      );
    }
  }
});

test('stays wired into the CI contract run', async () => {
  const configTest = await readFile(
    '.github/scripts/resolve-ci-test-plan-config.test.mjs',
    'utf8'
  );

  assert.match(configTest, /import '\.\/ci-lint-gate-contract\.test\.mjs';/);
  assert.ok(
    filters.web.includes('.github/scripts/ci-lint-gate-contract.test.mjs')
  );
  assert.ok(
    workflow.jobs['quality-test'].steps.some(
      (step) =>
        step.run?.includes('node --test') &&
        step.run.includes('.github/scripts/resolve-ci-test-plan-config.test.mjs')
    )
  );
});
