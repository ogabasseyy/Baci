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

function matches(pattern, path) {
  const expression = pattern.split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
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

test('touching the backstop workflow or its suite triggers the deployment script suite', () => {
  for (const path of [
    '.github/workflows/ops-promote-record.yml',
    '.github/scripts/ops-promote-record-contract.test.mjs',
    '.github/scripts/release-remote-validation.mjs',
  ]) {
    assert.ok(patterns.some((pattern) => matches(pattern, path)), `${path} must trigger deploy_scripts`);
  }
});
