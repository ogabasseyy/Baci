import { expect, it } from 'vitest';
import { oxygenRuntimeSnapshotSchema } from './runtime-view';

const snapshot = {
  workflowId: '11111111-1111-4111-8111-111111111111',
  stage: 'eligibility_required',
  version: 1,
  environment: 'staging',
  executionEnabled: true,
  approvalOtpReady: false,
  activationEnabled: false,
  settlementEnabled: false,
};

it('accepts only a known financial-details reason for a failed undecided check', () => {
  const state = {
    eligibilityStatus: 'failed',
    eligibilityFailureReason: 'financial_details_mismatch',
  };
  expect(
    oxygenRuntimeSnapshotSchema.safeParse({ ...snapshot, state }).success
  ).toBe(true);
  for (const invalid of [
    { ...state, eligibilityStatus: 'pending' },
    { ...state, eligible: true },
    { ...state, eligibilityFailureReason: 'raw-provider-message' },
  ]) {
    expect(
      oxygenRuntimeSnapshotSchema.safeParse({ ...snapshot, state: invalid })
        .success
    ).toBe(false);
  }
});
