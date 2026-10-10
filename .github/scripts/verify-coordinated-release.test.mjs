import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = new URL('./verify-coordinated-release.sh', import.meta.url);
const sha = 'b'.repeat(40);
const run = overrides => spawnSync('bash', [script.pathname], {
  env: { ...process.env, GITHUB_SHA: sha, EXPECTED_RELEASE_SHA: '', COORDINATION_ID: '', ...overrides },
  encoding: 'utf8',
});

test('ordinary releases retain existing behavior', () => {
  assert.equal(run({}).status, 0);
});
test('coordinated releases require an exact matching SHA', () => {
  assert.equal(run({ COORDINATION_ID: 'unique', EXPECTED_RELEASE_SHA: sha }).status, 0);
  for (const expected of ['', 'invalid', 'c'.repeat(40)]) {
    assert.notEqual(run({ COORDINATION_ID: 'unique', EXPECTED_RELEASE_SHA: expected }).status, 0);
  }
});
test('an optional expected SHA cannot be ignored on manual releases', () => {
  assert.notEqual(run({ EXPECTED_RELEASE_SHA: 'c'.repeat(40) }).status, 0);
});
