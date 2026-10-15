import assert from 'node:assert/strict';
import test from 'node:test';
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
