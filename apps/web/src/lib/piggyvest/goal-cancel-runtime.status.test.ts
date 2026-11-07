import { beforeEach, expect, it, vi } from 'vitest';
import { checkPrimaryWalletGoalCancelStatus } from './goal-cancel-runtime';
import {
  configuration,
  evidence,
  operationId,
  providerToken,
  scope,
} from './goal-cancel-runtime.test-support';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  reconcile: vi.fn(),
  transfer: vi.fn(),
}));
vi.mock('./webhook-alerts', () => ({ emitPiggyvestWebhookAlert: vi.fn() }));
vi.mock('./primary-wallet-savings-executor', () => ({
  createPrimaryWalletSavingsExecutor: () => mocks.execute,
}));
vi.mock('./goal-cancel-reconciliation', () => ({
  runGoalCancelReconciliation: mocks.reconcile,
}));
vi.mock('./transfers', () => ({ transferToWallet: mocks.transfer }));

function dbAnswers(...results: unknown[]) {
  mocks.execute.mockReset();
  for (const result of results)
    mocks.execute.mockResolvedValueOnce({ rows: [{ result }] });
}
beforeEach(() => {
  vi.clearAllMocks();
});

const statusInput = {
  configuration,
  reconciliationConfiguration: evidence,
  scope,
  providerToken,
  operationId,
};

it.each([
  [null, 'not_found'],
  ['confirmed', 'confirmed'],
  ['issued', 'not_started'],
] as const)('status %s reports %s with no provider call', async (state, expected) => {
  dbAnswers(state);
  expect(await checkPrimaryWalletGoalCancelStatus(statusInput)).toEqual({
    status: expected,
  });
  expect(mocks.reconcile).not.toHaveBeenCalled();
  expect(mocks.transfer).not.toHaveBeenCalled();
});

it('releases a stale reservation, then reports its new state', async () => {
  dbAnswers('reserved', true, 'released');
  expect(await checkPrimaryWalletGoalCancelStatus(statusInput)).toEqual({
    status: 'released',
  });
});

it('keeps a fresh reservation pending', async () => {
  dbAnswers('reserved', false, 'reserved');
  expect(await checkPrimaryWalletGoalCancelStatus(statusInput)).toEqual({
    status: 'pending',
  });
});

it('asks PiggyVest about a dispatched cancel and never posts', async () => {
  dbAnswers('dispatched');
  mocks.reconcile.mockResolvedValue({ status: 'pending' });
  expect(await checkPrimaryWalletGoalCancelStatus(statusInput)).toEqual({
    status: 'pending',
  });
  expect(mocks.reconcile).toHaveBeenCalledOnce();
  expect(mocks.transfer).not.toHaveBeenCalled();
});

it('maps a provider-reported failure to released', async () => {
  dbAnswers('dispatched');
  mocks.reconcile.mockResolvedValue({ status: 'cancelled' });
  expect(await checkPrimaryWalletGoalCancelStatus(statusInput)).toEqual({
    status: 'released',
  });
});

// A released attempt that WAS dispatched can still succeed at the provider.
// These start from the recorded 'released' state and exercise the status
// path; the SQL suite proves the database loads and settles such a row.
it('re-checks a released cancel and reports a late success as confirmed', async () => {
  dbAnswers('released');
  mocks.reconcile.mockResolvedValue({ status: 'confirmed' });
  expect(await checkPrimaryWalletGoalCancelStatus(statusInput)).toEqual({
    status: 'confirmed',
  });
  expect(mocks.reconcile).toHaveBeenCalledWith(
    expect.objectContaining({ operationId })
  );
  expect(mocks.transfer).not.toHaveBeenCalled();
});

it.each([
  [{ status: 'pending' }],
  [{ status: 'cancelled' }],
])('keeps a released cancel released when the re-check says %j', async (outcome) => {
  dbAnswers('released');
  mocks.reconcile.mockResolvedValue(outcome);
  expect(await checkPrimaryWalletGoalCancelStatus(statusInput)).toEqual({
    status: 'released',
  });
});

// Late success while a newer attempt is live: the database refuses to settle
// (conflict). It must never read as released: the money has moved at PiggyVest.
it.each([
  ['released'],
  ['dispatched'],
] as const)('reports needs_review, not released or pending, when settling a %s cancel conflicts', async (state) => {
  dbAnswers(state);
  mocks.reconcile.mockResolvedValue({ status: 'pending', needsReview: true });
  expect(await checkPrimaryWalletGoalCancelStatus(statusInput)).toEqual({
    status: 'needs_review',
  });
});

it('answers released when the re-check of a released cancel throws', async () => {
  dbAnswers('released');
  mocks.reconcile.mockRejectedValue(new Error('provider down'));
  expect(await checkPrimaryWalletGoalCancelStatus(statusInput)).toEqual({
    status: 'released',
  });
});

// Review is its own recorded state: whichever path settled it first (the
// webhook or a poll), every later status read says needs_review, and it is
// answered from the stored state with no provider call.
it('reports a recorded needs_review attempt as needs_review without asking PiggyVest', async () => {
  dbAnswers('needs_review');
  expect(await checkPrimaryWalletGoalCancelStatus(statusInput)).toEqual({
    status: 'needs_review',
  });
  expect(mocks.reconcile).not.toHaveBeenCalled();
  expect(mocks.transfer).not.toHaveBeenCalled();
});

it('keeps answering needs_review across repeated status checks', async () => {
  for (let check = 0; check < 3; check += 1) {
    dbAnswers('needs_review');
    expect(await checkPrimaryWalletGoalCancelStatus(statusInput)).toEqual({
      status: 'needs_review',
    });
  }
});

it('reports a review the operator has cleared as confirmed: the refund itself is done', async () => {
  dbAnswers('reviewed');
  expect(await checkPrimaryWalletGoalCancelStatus(statusInput)).toEqual({
    status: 'confirmed',
  });
  expect(mocks.reconcile).not.toHaveBeenCalled();
});
