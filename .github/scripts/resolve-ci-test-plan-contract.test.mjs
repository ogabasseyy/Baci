import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import test from 'node:test';
import YAML from 'yaml';
import { isFullAffectedTrigger } from './resolve-ci-test-plan-paths.mjs';

const PLANNER_SOURCES = [
  '.github/scripts/resolve-ci-test-plan.mjs',
  '.github/scripts/resolve-ci-test-plan-config.mjs',
];
const PROVIDER = '.github/scripts/vitest-changed-files-provider.mjs';
const NEW_PLANNER_FILES = [
  '.github/scripts/resolve-ci-test-plan-paths.mjs',
  '.github/scripts/resolve-ci-test-plan-paths.test.mjs',
  '.github/scripts/resolve-ci-test-plan-contract.test.mjs',
  '.github/scripts/resolve-ci-test-plan-classes.test.mjs',
  '.github/scripts/resolve-ci-test-plan-diff.test.mjs',
  '.github/scripts/resolve-ci-test-plan-git-fixture.test-support.mjs',
  PROVIDER,
  '.github/scripts/vitest-changed-files-provider.test.mjs',
  '.github/scripts/vitest-changed-files-provider-git.test.mjs',
];

const workflow = YAML.parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
const filters = YAML.parse(readFileSync('.github/filters/ci.yml', 'utf8'));

test('planner, path classes and provider changes always run the full suite', () => {
  for (const file of NEW_PLANNER_FILES) {
    assert.equal(isFullAffectedTrigger(file), true, file);
  }
  assert.equal(isFullAffectedTrigger('.github/workflows/ci.yml'), true);
});

test('the web and mobile admin gates list the planner modules', () => {
  for (const file of NEW_PLANNER_FILES) {
    assert.ok(filters.web.includes(file), `${file} must trigger the web gate`);
  }
  for (const file of [
    PROVIDER,
    '.github/scripts/resolve-ci-test-plan-paths.mjs',
  ]) {
    assert.ok(
      filters.mobile_admin.includes(file),
      `${file} must trigger mobile admin`
    );
  }
});

test('the config suite runs every planner suite', () => {
  const entrypoint = readFileSync(
    '.github/scripts/resolve-ci-test-plan-config.test.mjs',
    'utf8'
  );
  for (const name of [
    'resolve-ci-test-plan-classes.test.mjs',
    'resolve-ci-test-plan-contract.test.mjs',
    'resolve-ci-test-plan-diff.test.mjs',
    'resolve-ci-test-plan-paths.test.mjs',
    'vitest-changed-files-provider.test.mjs',
    'vitest-changed-files-provider-git.test.mjs',
  ]) {
    assert.ok(entrypoint.includes(`import './${name}';`), name);
  }
});

function plannerModes() {
  const modes = new Set();
  for (const file of PLANNER_SOURCES) {
    for (const match of readFileSync(file, 'utf8').matchAll(
      /\bmode:\s*'([a-z-]+)'/g
    )) {
      modes.add(match[1]);
    }
  }
  return modes;
}

// ci.yml hard-codes what each mode runs and ignores the planner's `command`.
// A mode it does not know falls through to the non-web path and the web suite
// would silently not run at all, so every mode must be handled there.
test('ci.yml handles every mode the planner can return', () => {
  const runTests = workflow.jobs['quality-test'].steps.find(
    (step) => step.name === 'Run Tests'
  ).run;
  const modes = plannerModes();

  assert.deepEqual(
    [...modes].sort(),
    [
      'config-smoke',
      'full-affected',
      'targeted-storefront-jest',
      'targeted-web-and-storefront-tests',
      'targeted-web-vitest',
    ],
    'a new planner mode needs a branch in the ci.yml "Run Tests" step first'
  );
  for (const mode of modes) {
    if (mode === 'full-affected') {
      assert.match(
        workflow.jobs['quality-test-web'].if,
        /test_plan_mode == 'full-affected'/
      );
      assert.match(runTests, /run-ci-non-web-tests\.mjs/);
    } else {
      assert.ok(
        runTests.includes(`"$TEST_PLAN_MODE" = "${mode}"`),
        `ci.yml has no branch for ${mode}`
      );
    }
  }
});

test('the targeted web branches keep the changed-files run the provider plugs into', () => {
  const runTests = workflow.jobs['quality-test'].steps.find(
    (step) => step.name === 'Run Tests'
  ).run;
  for (const mode of [
    'targeted-web-vitest',
    'targeted-web-and-storefront-tests',
  ]) {
    const branch = runTests
      .split(/\n\s*if \[ "\$TEST_PLAN_MODE" = /)
      .find((block) => block.startsWith(`"${mode}"`));
    assert.ok(branch, mode);
    assert.ok(
      branch.includes(
        'pnpm --filter @baci/web exec vitest run --changed "$TURBO_SCM_BASE" --passWithNoTests'
      ),
      `${mode} must run vitest --changed so the provider is used`
    );
  }
});

test('the web Vitest config uses the changed-files provider', async () => {
  const config = readFileSync('apps/web/vitest.config.ts', 'utf8');

  assert.match(
    config,
    /const changedFilesProvider = path\.resolve\(\s*__dirname,\s*'\.\.\/\.\.\/\.github\/scripts\/vitest-changed-files-provider\.mjs'/
  );
  // A missing file must not stop Vitest from starting (sparse checkouts).
  assert.match(
    config,
    /existsSync\(changedFilesProvider\)\s*\?\s*\{\s*experimental:\s*\{\s*vcsProvider:\s*changedFilesProvider/
  );
  const provider = await import(new URL(`../../${PROVIDER}`, import.meta.url));
  assert.equal(typeof provider.default.findChangedFiles, 'function');
});

test('the installed Vitest still supports experimental.vcsProvider', (t) => {
  let vitestDir;
  try {
    vitestDir = dirname(
      createRequire(join(process.cwd(), 'apps/web/package.json')).resolve(
        'vitest/package.json'
      )
    );
  } catch {
    t.skip('vitest is not installed in this job');
    return;
  }
  const chunks = join(vitestDir, 'dist/chunks');
  const supported = readdirSync(chunks)
    .filter((name) => name.endsWith('.js'))
    .some((name) =>
      readFileSync(join(chunks, name), 'utf8').includes(
        'experimental.vcsProvider'
      )
    );

  assert.ok(
    supported,
    'Vitest dropped experimental.vcsProvider: replace vitest-changed-files-provider.mjs before upgrading'
  );
});
