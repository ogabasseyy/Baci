import { expect, it } from 'vitest';
import { oxygenRuntimeSnapshotSchema } from '@/schemas/oxygen-runtime-view';
import { selectOxygenActionKey } from './oxygen-address-recovery';
import { pendingReadRecovery } from './oxygen-read-recovery';

it('resumes queued reads and offers a safe retry for interrupted saved-booking reads', () => {
  const id = '60000000-0000-4000-8000-000000000001';
  const key = '80000000-0000-4000-8000-000000000001';
  const snapshot = oxygenRuntimeSnapshotSchema.parse({
    workflowId: id,
    stage: 'approval_required',
    version: 1,
    environment: 'staging',
    executionEnabled: true,
    approvalOtpReady: true,
    activationEnabled: false,
    settlementEnabled: false,
    pending: {
      action: 'refresh_eligibility',
      status: 'queued',
      idempotencyKey: key,
    },
    state: {
      applicationReference: id,
      bookingReference: id,
      validated: true,
      kyc: {
        phone_status: 'DONE',
        bvn_status: 'DONE',
        selfie_status: 'DONE',
        nin_status: 'DONE',
        bank_status: 'DONE',
        address_status: 'DONE',
      },
      booking: {
        loan_reference: id,
        status: 'BOOKED',
        product_amount: 100000,
        equity_percentage: 25,
        equity_amount: 25000,
        loan_amount: 75000,
        loan_tenure: 3,
      },
    },
  });
  expect(pendingReadRecovery(snapshot)).toBe('refresh_eligibility');
  expect(
    selectOxygenActionKey(
      'refresh_eligibility',
      snapshot,
      null,
      pendingReadRecovery(snapshot)
    )
  ).toBe(key);
  const interrupted = {
    ...snapshot,
    pending: {
      action: 'refresh_eligibility',
      idempotencyKey: key,
      status: 'executing' as const,
    },
  };
  expect(pendingReadRecovery(interrupted)).toBe('refresh_eligibility');
  expect(
    pendingReadRecovery({
      ...snapshot,
      pending: {
        action: 'approve_booking',
        idempotencyKey: key,
        status: 'queued',
      },
    })
  ).toBe('refresh_eligibility');
  expect(
    pendingReadRecovery({
      ...snapshot,
      state: { ...snapshot.state, validated: false },
    })
  ).toBeNull();
  expect(
    pendingReadRecovery({
      ...snapshot,
      state: { ...snapshot.state, setupComplete: true },
    })
  ).toBeNull();
  expect(
    pendingReadRecovery({
      ...snapshot,
      state: {
        ...snapshot.state,
        eligibleAmount: 100000,
        minimumAmount: 10000,
        maxTenure: 3,
        offers: [{ tenure: 3, loanAmount: 100000 }],
      },
    })
  ).toBeNull();
  expect(
    selectOxygenActionKey(
      'refresh_eligibility',
      interrupted,
      null,
      pendingReadRecovery(interrupted)
    )
  ).not.toBe(key);
  expect(
    pendingReadRecovery({
      ...snapshot,
      state: { ...snapshot.state, paymentComplete: true },
    })
  ).toBeNull();
});
