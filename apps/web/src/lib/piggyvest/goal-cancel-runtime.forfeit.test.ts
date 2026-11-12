import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkPrimaryWalletGoalCancelStatus,
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
  reconcileForfeit: vi.fn(),
  transfer: vi.fn(),
  retrieve: vi.fn(),
  lookup: vi.fn(),
  alert: vi.fn(),
}));
vi.mock('./webhook-alerts', () => ({ emitPiggyvestWebhookAlert: mocks.alert }));
vi.mock('./primary-wallet-savings-executor', () => ({
  createPrimaryWalletSavingsExecutor: () => mocks.execute,
}));
vi.mock('./goal-cancel-reconciliation', () => ({
  runGoalCancelReconciliation: mocks.reconcile,
}));
vi.mock('./goal-cancel-forfeit-reconciliation', () => ({
  runGoalCancelForfeitReconciliation: mocks.reconcileForfeit,
}));
vi.mock('./transfers', () => ({ transferToWallet: mocks.transfer }));
vi.mock('./wallets', () => ({ retrievePiggyvestWallet: mocks.retrieve }));
vi.mock('./primary-wallet-savings-transfer-lookup', () => ({
  lookupSavingsTransferReference: mocks.lookup,
}));

const forfeitId = '77777777-7777-4777-8777-777777777777';
const forfeit = {
  operationId: forfeitId,
  goalId,
  amountKobo: 12000,
  sourceWalletId: 'goal-wallet',
  destinationWalletId: 'interest-wallet',
  reference: `pvb-forfeit-${goalId}`,
  businessId: 'business',
  providerCustomerId: 'customer',
};
const amounts = { principalKobo: 250000, forfeitedInterestKobo: 12000 };
const SPLIT = { status: 'dispatched', ...amounts };

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
  allowForfeitTransfers: true,
};
const statusInput = {
  configuration,
  reconciliationConfiguration: evidence,
  scope,
  providerToken,
  operationId,
  allowForfeitTransfers: true,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('PIGGYVEST_INTEREST_WALLET_ID', 'interest-wallet');
  mocks.retrieve.mockImplementation(async (_p: unknown, id: string) => ({
    id,
    api_customer_id: id === 'interest-wallet' ? 'ogabassey' : 'customer',
    business_id: 'business',
    currency: 'NGN',
    status: 'active',
    balance: id === 'goal-wallet' ? 262000 : 10,
  }));
  mocks.transfer.mockResolvedValue({ accepted: true });
  mocks.lookup.mockResolvedValue('not_found');
  mocks.reconcileForfeit.mockResolvedValue({ status: 'confirmed' });
});

describe('bugfix: an early cancel refunded the interest to the customer', () => {
  it('refunds the principal, then forfeits the interest to the interest wallet once it is confirmed', async () => {
    dbAnswers(
      { status: 'claimed', reservation },
      SPLIT,
      { status: 'claimed', forfeit },
      amounts
    );
    mocks.reconcile.mockResolvedValue({ status: 'confirmed' });
    expect(await submitPrimaryWalletGoalCancel(submitInput)).toEqual({
      status: 'confirmed',
      amounts,
    });
    expect(mocks.transfer).toHaveBeenCalledTimes(2);
    expect(mocks.transfer.mock.calls[0][1]).toMatchObject({
      amountKobo: 250000,
      destinationWalletId: 'main-wallet',
      reference: `pvb-cancel-${goalId}`,
    });
    expect(mocks.transfer.mock.calls[1][1]).toEqual({
      amountKobo: 12000,
      sourceWalletId: 'goal-wallet',
      destinationWalletId: 'interest-wallet',
      reference: `pvb-forfeit-${goalId}`,
      narration: 'Savings goal cancelled early: interest forfeited',
    });
    expect(mocks.reconcileForfeit).toHaveBeenCalledWith({
      configuration: evidence,
      providerToken,
      operationId: forfeitId,
    });
  });
});

it('never sends the interest while the principal is still pending', async () => {
  dbAnswers({ status: 'claimed', reservation }, SPLIT, amounts);
  mocks.reconcile.mockResolvedValue({ status: 'pending' });
  expect(await submitPrimaryWalletGoalCancel(submitInput)).toEqual({
    status: 'pending',
    amounts,
  });
  expect(mocks.transfer).toHaveBeenCalledOnce();
});

it('keeps the confirmed answer when the interest leg fails', async () => {
  dbAnswers(
    { status: 'claimed', reservation },
    SPLIT,
    { status: 'claimed', forfeit },
    amounts
  );
  mocks.reconcile.mockResolvedValue({ status: 'confirmed' });
  mocks.transfer
    .mockResolvedValueOnce({ accepted: true })
    .mockRejectedValueOnce(new Error('network'));
  expect(await submitPrimaryWalletGoalCancel(submitInput)).toEqual({
    status: 'confirmed',
    amounts,
  });
});

it('pages and sends nothing when interest is owed but no interest wallet is configured', async () => {
  dbAnswers(
    { status: 'claimed', reservation },
    { status: 'forfeit_unavailable' }
  );
  expect(await submitPrimaryWalletGoalCancel(submitInput)).toEqual({
    status: 'unavailable',
  });
  expect(mocks.transfer).not.toHaveBeenCalled();
  expect(mocks.alert).toHaveBeenCalledWith(
    'PIGGYVEST_GOAL_CANCEL_FORFEIT_UNAVAILABLE',
    { reason: 'interest_wallet_missing', operationId }
  );
});

it('pages and sends nothing when PiggyVest holds less than the saved principal', async () => {
  dbAnswers({ status: 'claimed', reservation }, { status: 'needs_review' });
  expect(await submitPrimaryWalletGoalCancel(submitInput)).toEqual({
    status: 'needs_review',
  });
  expect(mocks.transfer).not.toHaveBeenCalled();
  expect(mocks.alert).toHaveBeenCalledWith(
    'PIGGYVEST_GOAL_CANCEL_NEEDS_REVIEW',
    {
      reason: 'provider_balance_below_principal',
      operationId,
    }
  );
});

it('a status check of a confirmed cancel retries an unsent forfeit and returns the amounts', async () => {
  dbAnswers('confirmed', { status: 'claimed', forfeit }, amounts);
  expect(await checkPrimaryWalletGoalCancelStatus(statusInput)).toEqual({
    status: 'confirmed',
    amounts,
  });
  expect(mocks.transfer).toHaveBeenCalledOnce();
});

it('a status check never resends a dispatched forfeit', async () => {
  dbAnswers('confirmed', { status: 'pending', forfeitId }, amounts);
  await checkPrimaryWalletGoalCancelStatus(statusInput);
  expect(mocks.transfer).not.toHaveBeenCalled();
  expect(mocks.reconcileForfeit).toHaveBeenCalledOnce();
});

it('pages when the forfeit is first reported under review', async () => {
  dbAnswers('confirmed', { status: 'needs_review', alert: true }, amounts);
  await checkPrimaryWalletGoalCancelStatus(statusInput);
  expect(mocks.alert).toHaveBeenCalledWith(
    'PIGGYVEST_GOAL_CANCEL_FORFEIT_NEEDS_REVIEW',
    { reason: 'forfeit_needs_review', operationId }
  );
});

it('answers without amounts for an attempt made before the split', async () => {
  dbAnswers('confirmed', { status: 'none' }, null);
  expect(await checkPrimaryWalletGoalCancelStatus(statusInput)).toEqual({
    status: 'confirmed',
  });
});

it('pages and sends nothing when the database ever answers an inconsistent split', async () => {
  dbAnswers(
    { status: 'claimed', reservation },
    { status: 'dispatched', principalKobo: 250000, forfeitedInterestKobo: 1 }
  );
  expect(await submitPrimaryWalletGoalCancel(submitInput)).toEqual({
    status: 'needs_review',
  });
  expect(mocks.transfer).not.toHaveBeenCalled();
  expect(mocks.alert).toHaveBeenCalledWith(
    'PIGGYVEST_GOAL_CANCEL_NEEDS_REVIEW',
    {
      reason: 'split_inconsistent',
      operationId,
    }
  );
});

it('sends no new interest transfer while PiggyVest savings are switched off', async () => {
  dbAnswers('confirmed', amounts);
  expect(
    await checkPrimaryWalletGoalCancelStatus({
      ...statusInput,
      allowForfeitTransfers: false,
    })
  ).toEqual({ status: 'confirmed', amounts });
  expect(mocks.transfer).not.toHaveBeenCalled();
});
