import { beforeEach, expect, it, vi } from 'vitest';
import { forfeitDriverPorts } from './goal-cancel-forfeit-ports';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  transfer: vi.fn(),
  lookup: vi.fn(),
  reconcile: vi.fn(),
  alert: vi.fn(),
  retrieve: vi.fn(),
}));
vi.mock('./wallets', () => ({ retrievePiggyvestWallet: mocks.retrieve }));
vi.mock('./transfers', () => ({ transferToWallet: mocks.transfer }));
vi.mock('./primary-wallet-savings-transfer-lookup', () => ({
  lookupSavingsTransferReference: mocks.lookup,
}));
vi.mock('./goal-cancel-forfeit-reconciliation', () => ({
  runGoalCancelForfeitReconciliation: mocks.reconcile,
}));
vi.mock('./webhook-alerts', () => ({ emitPiggyvestWebhookAlert: mocks.alert }));

const operationId = '66666666-6666-4666-8666-666666666666';
const provider = { token: 'token', baseUrl: 'https://example.test' };
const forfeit = {
  operationId: '77777777-7777-4777-8777-777777777777',
  goalId: '55555555-5555-4555-8555-555555555555',
  amountKobo: 12000,
  sourceWalletId: 'goal-wallet',
  destinationWalletId: 'interest-wallet',
  reference: 'pvb-forfeit-55555555-5555-4555-8555-555555555555',
  businessId: 'business',
  providerCustomerId: 'customer',
};
beforeEach(() => vi.clearAllMocks());

it('pages only on the first report of a stuck claim', async () => {
  const claim = vi
    .fn()
    .mockResolvedValueOnce({ status: 'unavailable', alert: true })
    .mockResolvedValueOnce({ status: 'unavailable' });
  const ports = forfeitDriverPorts({
    claim,
    release: vi.fn(),
    unclaim: vi.fn(),
    provider,
    evidence: null,
    operationId,
    expectedDestinationWalletId: 'interest-wallet',
  });
  await ports.claim(operationId);
  await ports.claim(operationId);
  expect(mocks.alert).toHaveBeenCalledOnce();
  expect(mocks.alert).toHaveBeenCalledWith(
    'PIGGYVEST_GOAL_CANCEL_FORFEIT_UNAVAILABLE',
    { reason: 'interest_wallet_disabled', operationId }
  );
});

it('sends the forfeit from the goal wallet to the interest wallet under its own reference', async () => {
  const ports = forfeitDriverPorts({
    claim: vi.fn(),
    release: vi.fn(),
    unclaim: vi.fn(),
    provider,
    evidence: null,
    operationId,
    expectedDestinationWalletId: 'interest-wallet',
  });
  await ports.transfer(forfeit);
  expect(mocks.transfer).toHaveBeenCalledWith(provider, {
    amountKobo: 12000,
    sourceWalletId: 'goal-wallet',
    destinationWalletId: 'interest-wallet',
    reference: forfeit.reference,
    narration: 'Savings goal cancelled early: interest forfeited',
  });
  expect(ports.reconcile).toBeUndefined();
});

it('pages when a release caps the forfeit into review, and binds evidence reconciliation', async () => {
  const ports = forfeitDriverPorts({
    claim: vi.fn(),
    release: vi.fn().mockResolvedValue('needs_review'),
    unclaim: vi.fn(),
    provider,
    evidence: { integrationId: 'i' },
    operationId,
    expectedDestinationWalletId: 'interest-wallet',
  });
  expect(await ports.release(forfeit.operationId)).toBe('needs_review');
  expect(mocks.alert).toHaveBeenCalledWith(
    'PIGGYVEST_GOAL_CANCEL_FORFEIT_NEEDS_REVIEW',
    { reason: 'forfeit_rejected_three_times', operationId }
  );
  mocks.reconcile.mockResolvedValue({ status: 'confirmed' });
  await ports.reconcile?.(forfeit.operationId);
  expect(mocks.reconcile).toHaveBeenCalledWith({
    configuration: { integrationId: 'i' },
    providerToken: 'token',
    operationId: forfeit.operationId,
  });
});

const ownWallet = {
  id: 'interest-wallet',
  business_id: 'business',
  api_customer_id: 'ogabassey',
  currency: 'NGN',
  status: 'active',
};

it("accepts only Ogabassey's own active wallet in this business as the interest destination", async () => {
  const ports = forfeitDriverPorts({
    claim: vi.fn(),
    release: vi.fn(),
    unclaim: vi.fn(),
    provider,
    evidence: null,
    operationId,
    expectedDestinationWalletId: 'interest-wallet',
  });
  mocks.retrieve.mockResolvedValue(ownWallet);
  expect(await ports.verifyDestination(forfeit)).toBe(true);
  for (const wrong of [
    { business_id: 'another-business' },
    { api_customer_id: 'customer' },
    { status: 'frozen' },
    { id: 'someone-else' },
  ]) {
    mocks.retrieve.mockResolvedValue({ ...ownWallet, ...wrong });
    expect(await ports.verifyDestination(forfeit)).toBe(false);
  }
  // The check itself never pages; the hand-back does, once.
  expect(mocks.alert).not.toHaveBeenCalled();
});

it('pages once per forfeit when a failed wallet check hands it back', async () => {
  const unclaim = vi
    .fn()
    .mockResolvedValueOnce('unclaimed_first')
    .mockResolvedValueOnce('unclaimed');
  const ports = forfeitDriverPorts({
    claim: vi.fn(),
    release: vi.fn(),
    unclaim,
    provider,
    evidence: null,
    operationId,
    expectedDestinationWalletId: 'interest-wallet',
  });
  await ports.unclaim(forfeit.operationId);
  await ports.unclaim(forfeit.operationId);
  expect(mocks.alert).toHaveBeenCalledOnce();
  expect(mocks.alert).toHaveBeenCalledWith(
    'PIGGYVEST_GOAL_CANCEL_FORFEIT_UNAVAILABLE',
    { reason: 'interest_wallet_not_ours', operationId }
  );
});

it('refuses a wallet the deployment does not name as the interest wallet, even in this business', async () => {
  // PiggyVest would accept the wallet; only the deployment's setting differs.
  mocks.retrieve.mockResolvedValue(ownWallet);
  for (const expected of ['another-wallet', null]) {
    const ports = forfeitDriverPorts({
      claim: vi.fn(),
      release: vi.fn(),
      unclaim: vi.fn(),
      provider,
      evidence: null,
      operationId,
      expectedDestinationWalletId: expected,
    });
    expect(await ports.verifyDestination(forfeit)).toBe(false);
  }
});
