import { beforeEach, expect, it, vi } from 'vitest';
import {
  isPrimaryWalletGoalCompleteIssued,
  issuePrimaryWalletGoalComplete,
  submitPrimaryWalletGoalComplete,
} from './goal-complete-runtime';
import {
  configuration,
  evidence,
  goalId,
  operationId,
  pinProof,
  providerToken,
  reservation,
  scope,
} from './goal-complete-runtime.test-support';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  reconcile: vi.fn(),
  purchaseAlert: vi.fn(),
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
vi.mock('./goal-complete-reconciliation', () => ({
  runGoalCompleteReconciliation: mocks.reconcile,
}));
vi.mock('./goal-purchase-request-alert', () => ({
  alertGoalPurchaseRequest: mocks.purchaseAlert,
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
const submitInput = {
  configuration,
  reconciliationConfiguration: evidence,
  scope,
  providerToken,
  goalId,
  operationId,
  pinProof,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.execute.mockReset();
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
  mocks.purchaseAlert.mockResolvedValue('alerted');
});

it('issues the server operation id', async () => {
  dbAnswers({ status: 'issued', operationId, expiresAt: 'soon' });
  expect(
    await issuePrimaryWalletGoalComplete({ configuration, scope, goalId })
  ).toEqual({ status: 'issued', operationId, expiresAt: 'soon' });
});

it('passes a goal that is not yet eligible straight through, with no page', async () => {
  dbAnswers({ status: 'not_eligible' });
  expect(
    await issuePrimaryWalletGoalComplete({ configuration, scope, goalId })
  ).toEqual({ status: 'not_eligible' });
  expect(mocks.alert).not.toHaveBeenCalled();
});

it('pages an operator when the goal holds legacy funds at issue', async () => {
  dbAnswers({ status: 'needs_review' });
  expect(
    await issuePrimaryWalletGoalComplete({ configuration, scope, goalId })
  ).toEqual({ status: 'needs_review' });
  expect(mocks.alert).toHaveBeenCalledWith(
    'PIGGYVEST_GOAL_COMPLETE_NEEDS_REVIEW',
    { reason: 'legacy_funds_on_primary_goal' }
  );
});

it('refuses a scope bound to another integration', async () => {
  await expect(
    issuePrimaryWalletGoalComplete({
      configuration,
      scope: {
        ...scope,
        integrationId: '99999999-9999-4999-8999-999999999999',
      },
      goalId,
    })
  ).rejects.toThrow('Goal complete binding unavailable');
});

it('sends the provider balance once under the per-goal complete reference', async () => {
  dbAnswers({ status: 'claimed', reservation }, true);
  mocks.reconcile.mockResolvedValue({ status: 'pending' });
  expect(await submitPrimaryWalletGoalComplete(submitInput)).toEqual({
    status: 'pending',
  });
  expect(mocks.transfer).toHaveBeenCalledOnce();
  expect(mocks.transfer.mock.calls[0][1]).toEqual({
    amountKobo: 987654,
    sourceWalletId: 'goal-wallet',
    destinationWalletId: 'main-wallet',
    reference: `pvb-complete-${goalId}`,
    narration: 'Savings goal completed',
  });
  // The PIN proof travels in the reservation statement, nowhere else.
  expect(mocks.execute.mock.calls[0][1][2]).toBe(pinProof);
  expect(mocks.execute.mock.calls[1][1][3]).toBe('987654');
  expect(mocks.purchaseAlert).not.toHaveBeenCalled();
});

it('alerts the owner only after the settlement is confirmed', async () => {
  dbAnswers({ status: 'claimed', reservation }, true);
  mocks.reconcile.mockResolvedValue({ status: 'confirmed' });
  expect(await submitPrimaryWalletGoalComplete(submitInput)).toEqual({
    status: 'confirmed',
  });
  expect(mocks.purchaseAlert).toHaveBeenCalledWith({
    configuration: evidence,
    operationId,
  });
  expect(mocks.reconcile.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.purchaseAlert.mock.invocationCallOrder[0]
  );
});

it('still answers confirmed when the owner alert fails', async () => {
  dbAnswers({ status: 'claimed', reservation }, true);
  mocks.reconcile.mockResolvedValue({ status: 'confirmed' });
  mocks.purchaseAlert.mockRejectedValue(new Error('alert down'));
  expect(await submitPrimaryWalletGoalComplete(submitInput)).toEqual({
    status: 'confirmed',
  });
});

it('alerts for a replay of an already confirmed complete, so a lost alert is retried', async () => {
  dbAnswers({ status: 'confirmed' });
  expect(await submitPrimaryWalletGoalComplete(submitInput)).toEqual({
    status: 'confirmed',
  });
  expect(mocks.transfer).not.toHaveBeenCalled();
  expect(mocks.purchaseAlert).toHaveBeenCalledOnce();
});

it('keeps the submit result when the immediate status check throws', async () => {
  dbAnswers({ status: 'claimed', reservation }, true);
  mocks.reconcile.mockRejectedValue(new Error('down'));
  expect(await submitPrimaryWalletGoalComplete(submitInput)).toEqual({
    status: 'pending',
  });
});

it('tells the customer a settlement conflict is under review', async () => {
  dbAnswers({ status: 'claimed', reservation }, true);
  mocks.reconcile.mockResolvedValue({ status: 'pending', needsReview: true });
  expect(await submitPrimaryWalletGoalComplete(submitInput)).toEqual({
    status: 'needs_review',
  });
  expect(mocks.purchaseAlert).not.toHaveBeenCalled();
});

it('refuses a reservation for another business before any provider call', async () => {
  dbAnswers({
    status: 'claimed',
    reservation: { ...reservation, businessId: 'other' },
  });
  await expect(
    submitPrimaryWalletGoalComplete({
      ...submitInput,
      reconciliationConfiguration: undefined,
    })
  ).rejects.toThrow('Goal complete ownership unavailable');
  expect(mocks.retrieve).not.toHaveBeenCalled();
  expect(mocks.transfer).not.toHaveBeenCalled();
});

it('sends nothing when the goal is not eligible at reservation, and spends no balance read', async () => {
  dbAnswers({ status: 'not_eligible' });
  expect(await submitPrimaryWalletGoalComplete(submitInput)).toEqual({
    status: 'not_eligible',
  });
  expect(mocks.retrieve).not.toHaveBeenCalled();
  expect(mocks.transfer).not.toHaveBeenCalled();
});

it('pages an operator and sends nothing when reserve says needs_review', async () => {
  dbAnswers({ status: 'needs_review' });
  expect(await submitPrimaryWalletGoalComplete(submitInput)).toEqual({
    status: 'needs_review',
  });
  expect(mocks.alert).toHaveBeenCalledWith(
    'PIGGYVEST_GOAL_COMPLETE_NEEDS_REVIEW',
    { reason: 'legacy_funds_on_primary_goal', operationId }
  );
  expect(mocks.transfer).not.toHaveBeenCalled();
});

it('does not resend on a replay: pending goes to a status check', async () => {
  dbAnswers({ status: 'pending' });
  expect(
    await submitPrimaryWalletGoalComplete({
      ...submitInput,
      reconciliationConfiguration: undefined,
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
  expect(await submitPrimaryWalletGoalComplete(submitInput)).toEqual({
    status: 'too_large',
  });
  expect(mocks.transfer).not.toHaveBeenCalled();
  expect(mocks.execute.mock.calls[1][1][2]).toBe('cancel');
});

it('asks whether an operation id is live for the goal', async () => {
  dbAnswers(true);
  expect(
    await isPrimaryWalletGoalCompleteIssued({
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
