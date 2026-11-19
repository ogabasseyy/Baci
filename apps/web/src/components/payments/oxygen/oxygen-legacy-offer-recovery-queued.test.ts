import { expect, it } from 'vitest';
import { oxygenBookedSnapshot } from './oxygen-booked-snapshot.test-support';
import { isLegacyOfferRecoveryQueued } from './oxygen-legacy-offer-recovery-queued';

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
  expect(isLegacyOfferRecoveryQueued(snapshot)).toBe(true);
  expect(
    isLegacyOfferRecoveryQueued({
      ...snapshot,
      stage: 'plan_required',
      state: {
        ...snapshot.state,
        booking: undefined,
        bookingReference: undefined,
      },
      pending: { ...snapshot.pending, action: 'book' },
    })
  ).toBe(true);
  expect(
    isLegacyOfferRecoveryQueued({
      ...snapshot,
      pending: { ...snapshot.pending, status: 'executing' },
    })
  ).toBe(false);
  expect(
    isLegacyOfferRecoveryQueued({
      ...snapshot,
      state: { ...snapshot.state, offers: [{ tenure: 3, loanAmount: 100000 }] },
    })
  ).toBe(false);
});
