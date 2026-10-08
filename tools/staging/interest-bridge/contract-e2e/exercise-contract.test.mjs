import assert from 'node:assert/strict';
import test from 'node:test';
import { exerciseContract } from './exercise-contract.mjs';

test('real disposable signed receipt-to-notification contract E2E', async (context) => {
  const report = await exerciseContract((name, run) => context.test(name, run));
  assert.equal(report.checks.length, 10);
  assert.equal(report.snapshot.principalKobo, 10000);
  assert.equal(report.snapshot.paidInterestKobo, 733);
  assert.equal(report.snapshot.notifications, 1);
  assert.equal(report.snapshot.deliveries, 0);
  assert.equal(report.providerPayoutVerified, false);
  assert.equal(report.deviceReceiptVerified, false);
  assert.equal(report.liveWritesPerformed, false);
  assert.equal(report.pushSendPerformed, false);
  assert.equal(report.applicationOutcomes.applied, 1);
  assert.equal(report.applicationOutcomes.duplicate, 10);
  assert.match(report.sourceManifest.sha256, /^[a-f0-9]{64}$/);
  assert.ok(report.sourceManifest.sourceCount > 30);
});
