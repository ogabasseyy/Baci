import assert from 'node:assert/strict';
import test from 'node:test';
import { managedLeaseWindow } from './managed-lease-window.mjs';

const start = Date.parse('2026-09-22T15:59:10.000Z');
const expiry = '2026-09-29T15:59:10.000Z';
test('preserves an absolute deadline after preflight consumes time', () => {
  assert.deepEqual(managedLeaseWindow(start + 120000, 604800000, expiry), {
    duration: 604680000,
    expiresAt: expiry,
  });
});
test('keeps bounded relative leases for existing modes', () => {
  assert.equal(managedLeaseWindow(start, 60000).duration, 60000);
});
for (const value of [
  'invalid',
  '2026-09-22T15:59:10.000Z',
  '2026-09-30T15:59:10.000Z',
]) {
  test(`refuses invalid or out-of-bounds deadline ${value}`, () => {
    assert.throws(() => managedLeaseWindow(start, 60000, value));
  });
}
