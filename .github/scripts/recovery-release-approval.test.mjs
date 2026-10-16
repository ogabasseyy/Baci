import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { parseRecoveryReleaseApproval, recoveryReconciliationDispatchFields } from './recovery-release-approval.mjs';

const required = ['--approve-production', '--approve-prebuilt-fallback'];
test('legacy reconciliation needs an explicit additional approval', () => {
  assert.equal(parseRecoveryReleaseApproval(required), false);
  assert.deepEqual(recoveryReconciliationDispatchFields(false), []);
  assert.equal(parseRecoveryReleaseApproval([...required, '--approve-recovery-gate-reconciliation']), true);
  assert.deepEqual(recoveryReconciliationDispatchFields(true), ['-f', 'reconcile_checkout_recovery_legacy=true']);
});
test('unknown, duplicate or incomplete approval flags fail closed', () => {
  for (const args of [[], required.slice(0, 1), [...required, '--skip'], [...required, required[0]]]) {
    assert.throws(() => parseRecoveryReleaseApproval(args), /requires/);
  }
});

test('approval helper changes trigger both migration and deployment checks', () => {
  const filters = parse(readFileSync(new URL('../filters/ci.yml', import.meta.url), 'utf8'));
  for (const group of ['quiz_db', 'deploy_scripts']) {
    for (const path of ['.github/scripts/recovery-release-approval.mjs', '.github/scripts/recovery-release-approval.test.mjs']) {
      assert.ok(filters[group].includes(path), `${path} must trigger ${group}`);
    }
  }
  for (const path of ['.github/scripts/reconcile-checkout-recovery-legacy.sh', '.github/scripts/checkout-recovery-atomic-release.test.mjs']) {
    assert.ok(filters.quiz_db.includes(path), `${path} must trigger migration tests`);
  }
});
