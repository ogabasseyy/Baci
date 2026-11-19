import { expect, it } from 'vitest';
import { oxygenBookedSnapshot } from './oxygen-booked-snapshot.test-support';
import { oxygenPendingActionBlocked } from './oxygen-pending-action-blocked';

it('does not switch actions while a different approval is queued or executing', () => {
  for (const status of ['queued', 'executing', 'indeterminate'] as const) {
    const snapshot = {
      ...oxygenBookedSnapshot,
      pending: {
        action: 'approve_booking',
        status,
        idempotencyKey: oxygenBookedSnapshot.workflowId,
      },
    };
    expect(oxygenPendingActionBlocked(snapshot, 'refresh_eligibility')).toBe(
      true
    );
  }
  expect(
    oxygenPendingActionBlocked(oxygenBookedSnapshot, 'refresh_eligibility')
  ).toBe(false);
});
