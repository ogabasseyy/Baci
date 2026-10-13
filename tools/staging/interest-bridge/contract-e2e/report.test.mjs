import assert from 'node:assert/strict';
import test from 'node:test';
import { createContractReport } from './report.mjs';

test('reports counted application outcomes without claiming provider payout or push delivery', () => {
  const report = createContractReport(
    {
      snapshot: () => ({
        paidInterestKobo: 733,
        notifications: 1,
        deliveries: 0,
      }),
      outcomes: ['applied', 'duplicate', 'duplicate', 'deferred', 'conflict'],
      manifest: () => ({ sourceCount: 1, sha256: 'a'.repeat(64), entries: [] }),
    },
    ['synthetic-check']
  );
  assert.deepEqual(report.applicationOutcomes, {
    applied: 1,
    duplicate: 2,
    deferred: 1,
    conflict: 1,
  });
  assert.match(report.label, /^synthetic-disposable/);
  for (const flag of [
    'providerPayoutVerified',
    'deviceReceiptVerified',
    'liveWritesPerformed',
    'pushSendPerformed',
  ])
    assert.equal(report[flag], false);
});
