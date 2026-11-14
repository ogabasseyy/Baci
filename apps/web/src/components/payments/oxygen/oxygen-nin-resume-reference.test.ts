import { expect, it } from 'vitest';
import { oxygenRuntimeSnapshotSchema } from '@/schemas/oxygen-runtime-view';
import { pendingReadRecovery } from './oxygen-read-recovery';

it('fails closed for missing or malformed saved application references', () => {
  const snapshot = {
    workflowId: '60000000-0000-4000-8000-000000000001',
    stage: 'kyc_required',
    version: 2,
    environment: 'staging',
    executionEnabled: true,
    state: {},
    pending: {
      action: 'validate_nin',
      status: 'queued',
      idempotencyKey: '70000000-0000-4000-8000-000000000001',
    },
    approvalOtpReady: false,
    activationEnabled: false,
    settlementEnabled: false,
  };
  expect(
    pendingReadRecovery(oxygenRuntimeSnapshotSchema.parse(snapshot))
  ).toBeNull();
  expect(
    oxygenRuntimeSnapshotSchema.safeParse({
      ...snapshot,
      state: { applicationReference: 'not-a-uuid' },
    }).success
  ).toBe(false);
});
