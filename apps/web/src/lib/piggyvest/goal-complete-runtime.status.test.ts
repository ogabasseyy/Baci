import { beforeEach, expect, it, vi } from 'vitest';
import { checkPrimaryWalletGoalCompleteStatus } from './goal-complete-runtime';
import {
  configuration,
  evidence,
  operationId,
  providerToken,
  scope,
} from './goal-complete-runtime.test-support';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  reconcile: vi.fn(),
  purchaseAlert: vi.fn(),
  transfer: vi.fn(),
}));
vi.mock('./webhook-alerts', () => ({ emitPiggyvestWebhookAlert: vi.fn() }));
vi.mock('./primary-wallet-savings-executor', () => ({
  createPrimaryWalletSavingsExecutor: () => mocks.execute,
}));
vi.mock('./goal-complete-reconciliation', () => ({
  runGoalCompleteReconciliation: mocks.reconcile,
}));
vi.mock('./goal-purchase-request-alert', () => ({
  alertGoalPurchaseRequest: mocks.purchaseAlert,
}));
vi.mock('./transfers', () => ({ transferToWallet: mocks.transfer }));

function dbAnswers(...results: unknown[]) {
  mocks.execute.mockReset();
  for (const result of results)
    mocks.execute.mockResolvedValueOnce({ rows: [{ result }] });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.purchaseAlert.mockResolvedValue('alerted');
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
  ['issued', 'not_started'],
  ['needs_review', 'needs_review'],
  ['reviewed', 'needs_review'],
] as const)('status %s reports %s with no provider call and no alert', async (state, expected) => {
  dbAnswers(state);
  expect(await checkPrimaryWalletGoalCompleteStatus(statusInput)).toEqual({
    status: expected,
  });
  expect(mocks.reconcile).not.toHaveBeenCalled();
  expect(mocks.transfer).not.toHaveBeenCalled();
  expect(mocks.purchaseAlert).not.toHaveBeenCalled();
});

it('answers confirmed from the stored state and retries an unsent owner alert', async () => {
  dbAnswers('confirmed');
  expect(await checkPrimaryWalletGoalCompleteStatus(statusInput)).toEqual({
    status: 'confirmed',
  });
  expect(mocks.purchaseAlert).toHaveBeenCalledWith({
    configuration: evidence,
    operationId,
  });
  expect(mocks.reconcile).not.toHaveBeenCalled();
});

it('answers confirmed even when the owner alert fails', async () => {
  dbAnswers('confirmed');
  mocks.purchaseAlert.mockRejectedValue(new Error('alert down'));
  expect(await checkPrimaryWalletGoalCompleteStatus(statusInput)).toEqual({
    status: 'confirmed',
  });
});

it('releases a stale reservation, then reports its new state', async () => {
  dbAnswers('reserved', true, 'released');
  expect(await checkPrimaryWalletGoalCompleteStatus(statusInput)).toEqual({
    status: 'released',
  });
});

it('keeps a fresh reservation pending', async () => {
  dbAnswers('reserved', false, 'reserved');
  expect(await checkPrimaryWalletGoalCompleteStatus(statusInput)).toEqual({
    status: 'pending',
  });
});

it('asks PiggyVest about a dispatched complete and never posts', async () => {
  dbAnswers('dispatched');
  mocks.reconcile.mockResolvedValue({ status: 'pending' });
  expect(await checkPrimaryWalletGoalCompleteStatus(statusInput)).toEqual({
    status: 'pending',
  });
  expect(mocks.reconcile).toHaveBeenCalledOnce();
  expect(mocks.transfer).not.toHaveBeenCalled();
  expect(mocks.purchaseAlert).not.toHaveBeenCalled();
});

it('alerts the owner when the status check itself settles the complete', async () => {
  dbAnswers('dispatched');
  mocks.reconcile.mockResolvedValue({ status: 'confirmed' });
  expect(await checkPrimaryWalletGoalCompleteStatus(statusInput)).toEqual({
    status: 'confirmed',
  });
  expect(mocks.purchaseAlert).toHaveBeenCalledOnce();
});

it('maps a provider-reported failure to released', async () => {
  dbAnswers('dispatched');
  mocks.reconcile.mockResolvedValue({ status: 'cancelled' });
  expect(await checkPrimaryWalletGoalCompleteStatus(statusInput)).toEqual({
    status: 'released',
  });
});

it('re-checks a released complete and reports a late success as confirmed, with the owner alert', async () => {
  dbAnswers('released');
  mocks.reconcile.mockResolvedValue({ status: 'confirmed' });
  expect(await checkPrimaryWalletGoalCompleteStatus(statusInput)).toEqual({
    status: 'confirmed',
  });
  expect(mocks.purchaseAlert).toHaveBeenCalledOnce();
  expect(mocks.transfer).not.toHaveBeenCalled();
});

it.each([
  [{ status: 'pending' }],
  [{ status: 'cancelled' }],
])('keeps a released complete released when the re-check says %j', async (outcome) => {
  dbAnswers('released');
  mocks.reconcile.mockResolvedValue(outcome);
  expect(await checkPrimaryWalletGoalCompleteStatus(statusInput)).toEqual({
    status: 'released',
  });
  expect(mocks.purchaseAlert).not.toHaveBeenCalled();
});

it.each([
  ['released'],
  ['dispatched'],
] as const)('reports needs_review, not released or pending, when settling a %s complete conflicts', async (state) => {
  dbAnswers(state);
  mocks.reconcile.mockResolvedValue({ status: 'pending', needsReview: true });
  expect(await checkPrimaryWalletGoalCompleteStatus(statusInput)).toEqual({
    status: 'needs_review',
  });
  expect(mocks.purchaseAlert).not.toHaveBeenCalled();
});

it('answers released when the re-check of a released complete throws', async () => {
  dbAnswers('released');
  mocks.reconcile.mockRejectedValue(new Error('provider down'));
  expect(await checkPrimaryWalletGoalCompleteStatus(statusInput)).toEqual({
    status: 'released',
  });
});

it('refuses a status check without evidence configuration', async () => {
  await expect(
    checkPrimaryWalletGoalCompleteStatus({
      ...statusInput,
      reconciliationConfiguration: undefined,
    })
  ).rejects.toThrow('Goal complete evidence unavailable');
});
