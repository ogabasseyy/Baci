import { expect, it } from 'vitest';
import { oxygenBookedSnapshot } from './oxygen-booked-snapshot.test-support';
import { isLegacyApprovalQueued } from './oxygen-legacy-approval-queued';

it('only identifies a queued legacy approval with verified prerequisites', () => {
  const snapshot = {
    ...oxygenBookedSnapshot,
    stage: 'approval_required' as const,
    state: {
      ...oxygenBookedSnapshot.state,
      applicationReference: oxygenBookedSnapshot.workflowId,
      validated: true,
      kyc: {
        phone_status: 'DONE' as const,
        bvn_status: 'DONE' as const,
        selfie_status: 'DONE' as const,
        bank_status: 'DONE' as const,
        nin_status: 'DONE' as const,
        address_status: 'DONE' as const,
      },
    },
    pending: {
      action: 'approve_booking',
      status: 'queued' as const,
      idempotencyKey: oxygenBookedSnapshot.workflowId,
    },
  };
  expect(isLegacyApprovalQueued(snapshot)).toBe(true);
  expect(
    isLegacyApprovalQueued({
      ...snapshot,
      pending: { ...snapshot.pending, status: 'executing' },
    })
  ).toBe(false);
  expect(
    isLegacyApprovalQueued({
      ...snapshot,
      state: { ...snapshot.state, offers: [{ tenure: 3, loanAmount: 100000 }] },
    })
  ).toBe(false);
});
