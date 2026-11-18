import { expect, it } from 'vitest';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import { oxygenSnapshotForClient } from './eligibility-reason-contract';

const snapshot: OxygenRuntimeSnapshot = {
  workflowId: '60000000-0000-4000-8000-000000000001',
  stage: 'eligibility_required',
  version: 2,
  environment: 'production',
  executionEnabled: true,
  state: {
    validated: true,
    eligibilityStatus: 'failed',
    eligibilityFailureReason: 'financial_details_mismatch',
  },
  approvalOtpReady: false,
  checkoutPhone: '',
  checkoutAddress: {},
  activationEnabled: false,
  settlementEnabled: false,
};

it('retains the saved reason for a client that supports it', () => {
  const result = oxygenSnapshotForClient(snapshot, true);
  expect(result.state.eligibilityFailureReason).toBe(
    'financial_details_mismatch'
  );
  expect(result.state.eligibilityStatus).toBe('failed');
});

it('omits the reason for a legacy client without changing the saved snapshot', () => {
  const original = structuredClone(snapshot);
  const result = oxygenSnapshotForClient(snapshot, false);
  expect(result.state).toEqual({
    validated: true,
    eligibilityStatus: 'failed',
  });
  expect(snapshot).toEqual(original);
  expect(result.workflowId).toBe(snapshot.workflowId);
});

it('keeps a legacy snapshot without a reason intact for either client', () => {
  const legacy = { ...snapshot, state: { validated: true } };
  expect(oxygenSnapshotForClient(legacy, false)).toEqual(legacy);
  expect(oxygenSnapshotForClient(legacy, true)).toEqual(legacy);
});

it('exposes the pending stage only to clients that support progress', () => {
  const pending: OxygenRuntimeSnapshot = {
    ...snapshot,
    state: {
      eligibilityStatus: 'pending',
      eligibilityProgress: 'bank_statement',
    },
  };
  expect(oxygenSnapshotForClient(pending, true).state).toEqual({
    eligibilityStatus: 'pending',
  });
  expect(oxygenSnapshotForClient(pending, true, true)).toBe(pending);
});
