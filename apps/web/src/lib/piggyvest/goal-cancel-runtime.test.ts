import { beforeEach, expect, it, vi } from 'vitest';
import {
  isPrimaryWalletGoalCancelIssued,
  issuePrimaryWalletGoalCancel,
  submitPrimaryWalletGoalCancel,
} from './goal-cancel-runtime';

import {
  configuration,
  evidence,
  goalId,
  operationId,
  pinProof,
  providerToken,
  reservation,
  scope,
} from './goal-cancel-runtime.test-support';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  reconcile: vi.fn(),
  transfer: vi.fn(),
  retrieve: vi.fn(),
  lookup: vi.fn(),
  alert: vi.fn(),
}));
vi.mock('./webhook-alerts', () => ({
  emitPiggyvestWebhookAlert: mocks.alert,
}));
vi.mock('./primary-wallet-savings-executor', () => ({
  createPrimaryWalletSavingsExecutor: () => mocks.execute,
}));
vi.mock('./goal-cancel-reconciliation', () => ({
  runGoalCancelReconciliation: mocks.reconcile,
}));
vi.mock('./transfers', () => ({ transferToWallet: mocks.transfer }));
vi.mock('./wallets', () => ({ retrievePiggyvestWallet: mocks.retrieve }));
vi.mock('./primary-wallet-savings-transfer-lookup', () => ({
  lookupSavingsTransferReference: mocks.lookup,
}));

function dbAnswers(...results: unknown[]) {
  mocks.execute.mockReset();
  for (const result of results)
    mocks.execute.mockResolvedValueOnce({ rows: [{ result }] });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.retrieve.mockImplementation(async (_p: unknown, id: string) => ({
    id,
    api_customer_id: 'customer',
    business_id: 'business',
    currency: 'NGN',
    status: 'active',
    balance: id === 'goal-wallet' ? 987654 : 10,
  }));
  mocks.transfer.mockResolvedValue({ accepted: true });
  mocks.lookup.mockResolvedValue('not_found');
});

it('issues the server operation id', async () => {
  dbAnswers({ status: 'issued', operationId, expiresAt: 'soon' });
  expect(
    await issuePrimaryWalletGoalCancel({ configuration, scope, goalId })
  ).toEqual({ status: 'issued', operationId, expiresAt: 'soon' });
});

it('pages an operator and returns needs_review when the goal holds legacy funds at issue', async () => {
  dbAnswers({ status: 'needs_review' });
  expect(
    await issuePrimaryWalletGoalCancel({ configuration, scope, goalId })
  ).toEqual({ status: 'needs_review' });
  expect(mocks.alert).toHaveBeenCalledWith(
    'PIGGYVEST_GOAL_CANCEL_NEEDS_REVIEW',
    { reason: 'legacy_funds_on_primary_goal' }
  );
});

it('pages an operator, sends nothing and spends no balance read when reserve says needs_review', async () => {
  dbAnswers({ status: 'needs_review' });
  const result = await submitPrimaryWalletGoalCancel({
    configuration,
    reconciliationConfiguration: evidence,
    scope,
    providerToken,
    goalId,
    operationId,
    pinProof,
  });
  expect(result).toEqual({ status: 'needs_review' });
  expect(mocks.alert).toHaveBeenCalledWith(
    'PIGGYVEST_GOAL_CANCEL_NEEDS_REVIEW',
    { reason: 'legacy_funds_on_primary_goal', operationId }
  );
  expect(mocks.retrieve).not.toHaveBeenCalled();
  expect(mocks.transfer).not.toHaveBeenCalled();
});

it('refuses a scope bound to another integration', async () => {
  await expect(
    issuePrimaryWalletGoalCancel({
      configuration,
      scope: {
        ...scope,
        integrationId: '99999999-9999-4999-8999-999999999999',
      },
      goalId,
    })
  ).rejects.toThrow('Goal cancel binding unavailable');
});

const SPLIT = {
  status: 'dispatched',
  principalKobo: 900000,
  forfeitedInterestKobo: 87654,
};

it('sends only the saved principal once under the per-goal reference', async () => {
  dbAnswers({ status: 'claimed', reservation }, SPLIT);
  mocks.reconcile.mockResolvedValue({ status: 'pending' });
  const result = await submitPrimaryWalletGoalCancel({
    configuration,
    reconciliationConfiguration: evidence,
    scope,
    providerToken,
    goalId,
    operationId,
    pinProof,
  });
  expect(result).toEqual({ status: 'pending' });
  expect(mocks.transfer).toHaveBeenCalledOnce();
  expect(mocks.transfer.mock.calls[0][1]).toEqual({
    amountKobo: 900000,
    sourceWalletId: 'goal-wallet',
    destinationWalletId: 'main-wallet',
    reference: `pvb-cancel-${goalId}`,
    narration: 'Savings goal cancelled',
  });
  // The PIN proof travels in the reservation statement, nowhere else.
  expect(mocks.execute.mock.calls[0][1][2]).toBe(pinProof);
  // The database is given the provider balance and sizes both legs itself.
  expect(mocks.execute.mock.calls[1][1][2]).toBe('987654');
});

it('reports confirmed when the immediate status check settles', async () => {
  dbAnswers({ status: 'claimed', reservation }, SPLIT);
  mocks.reconcile.mockResolvedValue({ status: 'confirmed' });
  expect(
    await submitPrimaryWalletGoalCancel({
      configuration,
      reconciliationConfiguration: evidence,
      scope,
      providerToken,
      goalId,
      operationId,
      pinProof,
    })
  ).toEqual({ status: 'confirmed' });
});

it('keeps the submit result when the immediate status check throws', async () => {
  dbAnswers({ status: 'claimed', reservation }, SPLIT);
  mocks.reconcile.mockRejectedValue(new Error('down'));
  expect(
    await submitPrimaryWalletGoalCancel({
      configuration,
      reconciliationConfiguration: evidence,
      scope,
      providerToken,
      goalId,
      operationId,
      pinProof,
    })
  ).toEqual({ status: 'pending' });
});

it('refuses a reservation for another business before any provider call', async () => {
  dbAnswers({
    status: 'claimed',
    reservation: { ...reservation, businessId: 'other' },
  });
  await expect(
    submitPrimaryWalletGoalCancel({
      configuration,
      scope,
      providerToken,
      goalId,
      operationId,
      pinProof,
    })
  ).rejects.toThrow('Goal cancel ownership unavailable');
  expect(mocks.retrieve).not.toHaveBeenCalled();
  expect(mocks.transfer).not.toHaveBeenCalled();
});

it('does not resend on a replay: pending goes to a status check', async () => {
  dbAnswers({ status: 'pending' });
  expect(
    await submitPrimaryWalletGoalCancel({
      configuration,
      scope,
      providerToken,
      goalId,
      operationId,
      pinProof,
    })
  ).toEqual({ status: 'pending' });
  expect(mocks.transfer).not.toHaveBeenCalled();
});

it('releases the reservation and sends nothing when the balance is above the ceiling', async () => {
  mocks.retrieve.mockImplementation(async (_p: unknown, id: string) => ({
    id,
    api_customer_id: 'customer',
    business_id: 'business',
    currency: 'NGN',
    status: 'active',
    balance: id === 'goal-wallet' ? 10_000_000_000 : 10,
  }));
  dbAnswers({ status: 'claimed', reservation }, true);
  expect(
    await submitPrimaryWalletGoalCancel({
      configuration,
      scope,
      providerToken,
      goalId,
      operationId,
      pinProof,
    })
  ).toEqual({ status: 'too_large' });
  expect(mocks.transfer).not.toHaveBeenCalled();
  // The second statement is the 'cancel' transition, not a dispatch.
  expect(mocks.execute.mock.calls[1][1][2]).toBe('cancel');
});

it('asks whether an operation id is live for the goal', async () => {
  dbAnswers(true);
  expect(
    await isPrimaryWalletGoalCancelIssued({
      configuration,
      scope,
      goalId,
      operationId,
    })
  ).toBe(true);
  expect(mocks.execute.mock.calls[0][1].slice(1)).toEqual([
    goalId,
    operationId,
  ]);
});
