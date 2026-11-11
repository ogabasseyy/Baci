import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import test from 'node:test';
import YAML from 'yaml';
import { isFullAffectedTrigger } from './resolve-ci-test-plan.mjs';

const PLANNER_SOURCES = [
  '.github/scripts/resolve-ci-test-plan.mjs',
  '.github/scripts/resolve-ci-test-plan-config.mjs',
];
const PROVIDER = '.github/scripts/vitest-changed-files-provider.mjs';
const NEW_PLANNER_FILES = [
  '.github/scripts/resolve-ci-test-plan-cli.mjs',
  '.github/scripts/resolve-ci-test-plan-git.mjs',
  '.github/scripts/resolve-ci-test-plan-paths.mjs',
  '.github/scripts/resolve-ci-test-plan-paths.test.mjs',
  '.github/scripts/resolve-ci-test-plan-readers.mjs',
  '.github/scripts/resolve-ci-test-plan-readers.test.mjs',
  '.github/scripts/resolve-ci-test-plan-reasons.mjs',
  '.github/scripts/resolve-ci-test-plan-contract.test.mjs',
  '.github/scripts/resolve-ci-test-plan-cases.test-support.mjs',
  '.github/scripts/resolve-ci-test-plan-classes.test.mjs',
  '.github/scripts/resolve-ci-test-plan-diff.test.mjs',
  '.github/scripts/resolve-ci-test-plan-triggers.test.mjs',
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
    '.github/scripts/resolve-ci-test-plan-cli.mjs',
    '.github/scripts/resolve-ci-test-plan-paths.mjs',
    '.github/scripts/resolve-ci-test-plan-readers.mjs',
    '.github/scripts/resolve-ci-test-plan-reasons.mjs',
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
    'resolve-ci-test-plan-readers.test.mjs',
    'resolve-ci-test-plan-triggers.test.mjs',
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
      /\bmode:\s*['"]([\w-]+)['"]/g
    )) {
      modes.add(match[1]);
    }
  }
  return modes;
}

// The step of `quality-test` that branches on the planner mode. It is found by
// what it does, not by its name, so renaming the step does not break the test.
function modeStepScript() {
  const step = workflow.jobs['quality-test'].steps.find(
    (candidate) =>
      typeof candidate.run === 'string' &&
      candidate.run.includes('TEST_PLAN_MODE')
  );
  assert.ok(
    step,
    'quality-test needs a step whose script branches on $TEST_PLAN_MODE'
  );
  return step.run;
}

// `if [ "$TEST_PLAN_MODE" = "mode" ]` in any quoting; returns where it starts.
function modeBranchStart(script, mode) {
  const pattern = new RegExp(`TEST_PLAN_MODE["']?\\s*==?\\s*["']?${mode}["']?`);
  return script.search(pattern);
}

// ci.yml hard-codes what each mode runs and ignores the planner's `command`.
// A mode it does not know falls through to the non-web path and the web suite
// would silently not run at all, so every mode must be handled there.
test('ci.yml handles every mode the planner can return', () => {
  const runTests = modeStepScript();
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
    'a new planner mode needs a branch in the ci.yml mode step first'
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
        modeBranchStart(runTests, mode) !== -1,
        `ci.yml has no branch for ${mode}`
      );
    }
  }
});

test('the targeted web branches keep the changed-files run the provider plugs into', () => {
  const runTests = modeStepScript();
  for (const mode of [
    'targeted-web-vitest',
    'targeted-web-and-storefront-tests',
  ]) {
    const start = modeBranchStart(runTests, mode);
    assert.ok(start !== -1, `ci.yml has no branch for ${mode}`);
    // Each branch ends with `exit 0`.
    const end = runTests.indexOf('exit 0', start);
    const branch = runTests.slice(start, end === -1 ? undefined : end);
    assert.match(
      branch,
      /vitest run --changed "\$TURBO_SCM_BASE" --passWithNoTests/,
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
  assert.match(
    config,
    /const changedFilesPaths = path\.resolve\(\s*__dirname,\s*'\.\.\/\.\.\/\.github\/scripts\/resolve-ci-test-plan-paths\.mjs'/
  );
  // Vitest loads the provider on every run, and the provider imports the path
  // classes: a sparse checkout without either file must not stop Vitest.
  assert.match(
    config,
    /existsSync\(changedFilesProvider\)\s*&&\s*existsSync\(changedFilesPaths\)\s*\?\s*\{\s*experimental:\s*\{\s*vcsProvider:\s*changedFilesProvider/
  );
  const provider = await import(new URL(`../../${PROVIDER}`, import.meta.url));
  assert.equal(typeof provider.default.findChangedFiles, 'function');
});

// Vitest never runs Playwright specs. Their validation is the browser workflow,
// so it must really run for every pull request and cover every spec folder that
// the planner targets. experience-browser has no pull request workflow today; it
// was already targeted-only before this planner change.
test('every Playwright spec folder is run by the browser workflow on every pull request, or is listed as having none', () => {
  const browser = YAML.parse(
    readFileSync('.github/workflows/checkout-browser.yml', 'utf8')
  );
  const trigger = browser.on ?? browser[true];
  const commands = Object.values(browser.jobs)
    .flatMap((job) => job.steps)
    .map((step) => step.run ?? '')
    .join('\n');

  assert.ok(
    trigger.pull_request,
    'checkout-browser.yml must run on pull_request'
  );
  assert.equal(trigger.pull_request.paths, undefined);
  assert.equal(trigger.pull_request['paths-ignore'], undefined);
  assert.match(commands, /test:checkout:browser/);
  assert.match(
    commands,
    /tests\/oxygen-policy-browser\/playwright\.config\.ts/
  );
  assert.match(
    commands,
    /tests\/oxygen-cookie-harness\/playwright\.config\.ts/
  );

  const covered = new Set([
    'apps/web/tests/checkout-browser',
    'apps/web/tests/oxygen-policy-browser',
    'apps/web/tests/oxygen-cookie-harness',
  ]);
  const NO_PULL_REQUEST_WORKFLOW = new Set([
    'apps/web/tests/experience-browser',
  ]);
  // Filtered in Node, not with a git pathspec, so the result cannot depend on how
  // git expands `**`; the checks below fail if the list ever comes back empty.
  const folders = new Set(
    execFileSync('git', ['ls-files', 'apps/web'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
      .split('\n')
      .filter((file) => file.endsWith('.pw.ts'))
      .map((file) => file.split('/').slice(0, 4).join('/'))
  );
  assert.ok(
    folders.size > 0,
    'found no Playwright spec: the enumeration broke'
  );
  for (const folder of [...covered, ...NO_PULL_REQUEST_WORKFLOW]) {
    assert.ok(
      folders.has(folder),
      `${folder} no longer holds Playwright specs: drop it from this list`
    );
  }
  for (const folder of folders) {
    assert.ok(
      covered.has(folder) || NO_PULL_REQUEST_WORKFLOW.has(folder),
      `${folder} holds Playwright specs that no pull request workflow runs: add it to checkout-browser.yml`
    );
  }
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
