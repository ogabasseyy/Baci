import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { oxygenRuntimeSnapshotSchema } from '@/schemas/oxygen-runtime-view';
import { oxygenActionAllowed } from './runtime-policy';
import { performOxygenAction } from './runtime-service';

const id = '60000000-0000-4000-8000-000000000001';
const snapshot = {
  workflowId: id,
  stage: 'plan_required',
  version: 4,
  environment: 'staging',
  executionEnabled: true,
  bookingBlock: 'active_loan',
  state: {
    applicationReference: id,
    validated: true,
    eligible: true,
    kyc: {
      bvn_status: 'DONE',
      nin_status: 'DONE',
      bank_status: 'DONE',
      phone_status: 'DONE',
      selfie_status: 'DONE',
      address_status: 'DONE',
    },
  },
  approvalOtpReady: false,
  activationEnabled: false,
  settlementEnabled: false,
};
it('rejects a fresh booking before enqueue, worker login or any provider call', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: snapshot, error: null });
  const worker = vi.fn();
  const call = vi.fn();
  await expect(
    performOxygenAction({ rpc }, worker, { call }, 'partner', new Set(), {
      workflowId: id,
      version: 4,
      idempotencyKey: id,
      command: { action: 'book', equityPercentage: 35, tenure: 3 },
    })
  ).rejects.toMatchObject({ code: 'OXYGEN_ACTIVE_LOAN' });
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(worker).not.toHaveBeenCalled();
  expect(call).not.toHaveBeenCalled();
});
it('keeps booking blocked after KYC or eligibility refresh, while allowing reads', () => {
  const context = oxygenRuntimeSnapshotSchema.parse(snapshot);
  expect(
    oxygenActionAllowed(context, {
      action: 'book',
      equityPercentage: 35,
      tenure: 3,
    })
  ).toBe(false);
  expect(oxygenActionAllowed(context, { action: 'refresh_eligibility' })).toBe(
    true
  );
  expect(oxygenActionAllowed(context, { action: 'refresh_kyc' })).toBe(true);
  expect(
    oxygenActionAllowed(
      { ...context, bookingBlock: null },
      { action: 'book', equityPercentage: 35, tenure: 3 }
    )
  ).toBe(true);
});
it('only accepts the safe blocker enum and keeps financial flags false', () => {
  expect(oxygenRuntimeSnapshotSchema.safeParse(snapshot).success).toBe(true);
  expect(
    oxygenRuntimeSnapshotSchema.safeParse({
      ...snapshot,
      bookingBlock: 'raw provider detail',
    }).success
  ).toBe(false);
  expect(
    oxygenRuntimeSnapshotSchema.safeParse({
      ...snapshot,
      activationEnabled: true,
    }).success
  ).toBe(false);
});
