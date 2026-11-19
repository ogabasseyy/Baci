import { expect, it } from 'vitest';
import { oxygenRuntimeSnapshotSchema } from './oxygen-runtime-view';

const snapshot = {
  workflowId: '60000000-0000-4000-8000-000000000001',
  stage: 'application_required',
  version: 0,
  environment: 'production',
  executionEnabled: false,
  state: {},
  approvalOtpReady: false,
  activationEnabled: false,
  settlementEnabled: false,
};
it('accepts a disabled production view with safe defaults', () => {
  expect(oxygenRuntimeSnapshotSchema.parse(snapshot)).toMatchObject({
    checkoutPhone: '',
    checkoutAddress: {},
  });
});
it('rejects identity secrets, activation or settlement claims and invalid state', () => {
  for (const field of ['activityToken', 'newUserToken', 'phone'])
    expect(
      oxygenRuntimeSnapshotSchema.safeParse({
        ...snapshot,
        state: { [field]: 'private' },
      }).success
    ).toBe(false);
  expect(
    oxygenRuntimeSnapshotSchema.safeParse({
      ...snapshot,
      activationEnabled: true,
    }).success
  ).toBe(false);
  expect(
    oxygenRuntimeSnapshotSchema.safeParse({
      ...snapshot,
      settlementEnabled: true,
    }).success
  ).toBe(false);
  expect(
    oxygenRuntimeSnapshotSchema.safeParse({ ...snapshot, version: -1 }).success
  ).toBe(false);
});

it('rejects a public mismatch reason alongside a pending or declined result', () => {
  for (const state of [
    { eligibilityStatus: 'pending' },
    { eligibilityStatus: 'failed', eligible: false },
  ]) {
    expect(
      oxygenRuntimeSnapshotSchema.safeParse({
        ...snapshot,
        state: {
          ...state,
          eligibilityFailureReason: 'financial_details_mismatch',
        },
      }).success
    ).toBe(false);
  }
});
