import { expect, it } from 'vitest';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import { pendingReadRecovery } from './oxygen-read-recovery';

const snapshot: OxygenRuntimeSnapshot = {
  workflowId: '60000000-0000-4000-8000-000000000001',
  stage: 'kyc_required',
  version: 4,
  environment: 'staging',
  executionEnabled: true,
  state: {
    applicationReference: '60000000-0000-4000-8000-000000000002',
    validated: true,
  },
  pending: {
    action: 'selfie_link',
    status: 'queued',
    idempotencyKey: '60000000-0000-4000-8000-000000000003',
  },
  approvalOtpReady: false,
  checkoutPhone: '',
  checkoutAddress: {},
  activationEnabled: false,
  settlementEnabled: false,
};
it('offers recovery only for queued, bound, enabled pre-booking selfie requests', () => {
  expect(pendingReadRecovery(snapshot)).toBe('selfie_link');
  expect(
    pendingReadRecovery({ ...snapshot, stage: 'eligibility_required' })
  ).toBe('selfie_link');
  expect(
    pendingReadRecovery({ ...snapshot, executionEnabled: false })
  ).toBeNull();
  expect(
    pendingReadRecovery({
      ...snapshot,
      state: { ...snapshot.state, validated: false },
    })
  ).toBeNull();
  expect(
    pendingReadRecovery({
      ...snapshot,
      state: { ...snapshot.state, applicationReference: undefined },
    })
  ).toBeNull();
  expect(
    pendingReadRecovery({
      ...snapshot,
      state: {
        ...snapshot.state,
        bookingReference: '60000000-0000-4000-8000-000000000004',
      },
    })
  ).toBeNull();
  expect(pendingReadRecovery({ ...snapshot, stage: 'activated' })).toBeNull();
  expect(
    pendingReadRecovery({ ...snapshot, stage: 'reconciliation_required' })
  ).toBeNull();
  expect(
    pendingReadRecovery({
      ...snapshot,
      pending: {
        action: 'selfie_link',
        idempotencyKey: '60000000-0000-4000-8000-000000000003',
        status: 'executing',
      },
    })
  ).toBeNull();
  expect(
    pendingReadRecovery({
      ...snapshot,
      pending: {
        action: 'selfie_link',
        idempotencyKey: '60000000-0000-4000-8000-000000000003',
        status: 'indeterminate',
      },
    })
  ).toBeNull();
});
