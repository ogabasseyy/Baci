import { createHash } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  checkPrimaryWalletGoalCancelStatus,
  issuePrimaryWalletGoalCancel,
  submitPrimaryWalletGoalCancel,
} from './goal-cancel-runtime';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  reconcile: vi.fn(),
  transfer: vi.fn(),
  retrieve: vi.fn(),
  lookup: vi.fn(),
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

const integrationId = '11111111-1111-4111-8111-111111111111';
const goalId = '55555555-5555-4555-8555-555555555555';
const operationId = '66666666-6666-4666-8666-666666666666';
const database = {
  host: 'db.example.com',
  port: 5432,
  name: 'postgres',
  login: 'baci_piggyvest_primary_authorizer',
  password: createHash('sha256').update('s6-db').digest('hex'),
  certificateAuthority: 'test-ca',
};
const configuration = { integrationId, environment: 'staging', database };
const evidence = {
  integrationId,
  environment: 'staging',
  database: { ...database, login: 'baci_piggyvest_primary_evidence' },
};
const scope = {
  integrationId,
  environment: 'staging',
  merchantId: '22222222-2222-4222-8222-222222222222',
  customerId: '33333333-3333-4333-8333-333333333333',
  userId: '44444444-4444-4444-8444-444444444444',
  businessId: 'business',
};
const providerToken = createHash('sha256').update('s6-token').digest('hex');
const pinProof = createHash('sha256').update('s6-proof').digest('hex');
const reservation = {
  operationId,
  goalId,
  sourceWalletId: 'goal-wallet',
  destinationWalletId: 'main-wallet',
  reference: `pvb-cancel-${goalId}`,
  businessId: 'business',
  providerCustomerId: 'customer',
};
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

it('sends the provider balance once under the per-goal reference', async () => {
  dbAnswers({ status: 'claimed', reservation }, true);
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
    amountKobo: 987654,
    sourceWalletId: 'goal-wallet',
    destinationWalletId: 'main-wallet',
    reference: `pvb-cancel-${goalId}`,
    narration: 'Savings goal cancelled',
  });
  // The PIN proof travels in the reservation statement, nowhere else.
  expect(mocks.execute.mock.calls[0][1][2]).toBe(pinProof);
  expect(mocks.execute.mock.calls[1][1][3]).toBe('987654');
});

it('reports confirmed when the immediate status check settles', async () => {
  dbAnswers({ status: 'claimed', reservation }, true);
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
  dbAnswers({ status: 'claimed', reservation }, true);
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
  ['released', 'released'],
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
