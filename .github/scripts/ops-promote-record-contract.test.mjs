import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Locks the Ops Promote Record backstop shape: a follow-up touching
// only the workflow must keep tripping the deployment script suite,
// and the workflow must keep validating the operational branch from
// the last validated tip (fast-forward enforced) instead of silently
// degrading to shape-only or exit-green checks.
const workflow = readFileSync(new URL('../workflows/ops-promote-record.yml', import.meta.url), 'utf8');
const filters = readFileSync(new URL('../filters/ci.yml', import.meta.url), 'utf8');
const deployScripts = filters.split(/^deploy_scripts:\s*$/m)[1]?.split(/^\S/m)[0] ?? '';
const patterns = [...deployScripts.matchAll(/^\s+- '([^']+)'/gm)].map((match) => match[1]);

// paths-filter (dorny) uses minimatch-style semantics: a single '*'
// does not cross '/', only '**' does. Mirror that so a future
// wildcard pattern cannot pass here while behaving differently in CI.
function matches(pattern, path) {
  const expression = pattern
    .split('**')
    .map((part) => part.split('*')
      .map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[^/]*'))
    .join('.*');
  return new RegExp(`^${expression}$`).test(path);
}

test('the scheduled backstop validates the operational branch from the last validated tip', () => {
  assert.match(workflow, /schedule:\s*\n\s+- cron:/);
  assert.match(workflow, /concurrency:\s*\n\s*group: ops-promote-record/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /git ls-remote --heads origin ops\/gigl-promote-record/);
  assert.match(workflow, /git fetch origin ops\/gigl-promote-record/);
  assert.match(workflow, /node ci_scripts\/validate-promote-record\.mjs "\$tip" "\$previous"/);
});

test('a cache miss fails closed instead of silently re-seeding the tip', () => {
  assert.match(workflow, /confirm_reseed/);
  assert.match(workflow, /refusing to silently re-seed/);
});

test('the cached tip is shape-checked before it reaches git fetch', () => {
  assert.match(workflow, /tr -cd '0-9a-f'/);
  assert.match(workflow, /is not a 40-char hex SHA; refusing to fetch it/);
  assert.match(workflow, /git fetch origin -- "\$previous"/);
  // The guard must precede the fetch that consumes the cached value:
  // quoting alone does not stop git option parsing.
  assert.ok(
    workflow.indexOf("tr -cd '0-9a-f'") < workflow.indexOf('git fetch origin -- "$previous"'),
    'shape guard must precede the cached-tip fetch',
  );
});

test('a missing branch fails closed instead of exiting green', () => {
  assert.match(workflow, /is missing; failing closed without validation/);
  assert.doesNotMatch(workflow, /nothing to validate/);
});

test('touching the backstop workflow or its suite triggers the deployment script suite', () => {
  for (const path of [
    '.github/workflows/ops-promote-record.yml',
    '.github/scripts/ops-promote-record-contract.test.mjs',
    '.github/scripts/release-remote-validation.mjs',
  ]) {
    assert.ok(patterns.some((pattern) => matches(pattern, path)), `${path} must trigger deploy_scripts`);
  }
});

test('pattern matching mirrors paths-filter glob semantics', () => {
  assert.ok(matches('.github/scripts/release-remote-validation.mjs', '.github/scripts/release-remote-validation.mjs'));
  assert.ok(!matches('.github/scripts/*.mjs', '.github/scripts/nested/extra.mjs'));
  assert.ok(matches('.github/scripts/*.mjs', '.github/scripts/extra.mjs'));
  assert.ok(matches('vps-workers/**', 'vps-workers/lib/deep/file.sh'));
});
