import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    .mockResolvedValueOnce({
      status: 'unavailable',
      forfeitId: forfeit.operationId,
      alert: true,
    })
    .mockResolvedValueOnce({
      status: 'unavailable',
      forfeitId: forfeit.operationId,
    });
  const ports = forfeitDriverPorts({
    claim,
    release: vi.fn(),
    unclaim: vi.fn(),
    markPosting: vi.fn(),
    ackAlert: vi.fn().mockResolvedValue('acked'),
    provider,
    evidence: null,
    operationId,
    expectedDestinationWalletId: 'interest-wallet',
    expectedDestinationOwnerId: 'ogabassey',
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
    markPosting: vi.fn(),
    ackAlert: vi.fn().mockResolvedValue('acked'),
    provider,
    evidence: null,
    operationId,
    expectedDestinationWalletId: 'interest-wallet',
    expectedDestinationOwnerId: 'ogabassey',
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
    markPosting: vi.fn(),
    ackAlert: vi.fn().mockResolvedValue('acked'),
    provider,
    evidence: { integrationId: 'i' },
    operationId,
    expectedDestinationWalletId: 'interest-wallet',
    expectedDestinationOwnerId: 'ogabassey',
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
const goalWallet = {
  id: 'goal-wallet',
  business_id: 'business',
  api_customer_id: 'customer',
  currency: 'NGN',
  status: 'active',
  balance: 12000,
};
// Answers per wallet id: the interest destination, then the goal source.
const wallets =
  (source: Record<string, unknown> = goalWallet) =>
  async (_provider: unknown, id: string) =>
    id === 'goal-wallet' ? source : ownWallet;

it("accepts only Ogabassey's own active wallet in this business as the interest destination", async () => {
  const ports = forfeitDriverPorts({
    claim: vi.fn(),
    release: vi.fn(),
    unclaim: vi.fn(),
    markPosting: vi.fn(),
    ackAlert: vi.fn().mockResolvedValue('acked'),
    provider,
    evidence: null,
    operationId,
    expectedDestinationWalletId: 'interest-wallet',
    expectedDestinationOwnerId: 'ogabassey',
  });
  mocks.retrieve.mockImplementation(wallets());
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
    markPosting: vi.fn(),
    ackAlert: vi.fn().mockResolvedValue('acked'),
    provider,
    evidence: null,
    operationId,
    expectedDestinationWalletId: 'interest-wallet',
    expectedDestinationOwnerId: 'ogabassey',
  });
  await ports.unclaim(forfeit.operationId, 'mismatch');
  await ports.unclaim(forfeit.operationId, 'mismatch');
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
      markPosting: vi.fn(),
      ackAlert: vi.fn().mockResolvedValue('acked'),
      provider,
      evidence: null,
      operationId,
      expectedDestinationWalletId: expected,
      expectedDestinationOwnerId: 'ogabassey',
    });
    expect(await ports.verifyDestination(forfeit)).toBe(false);
  }
});

it('pages a wallet-check outage as a failed check, not a mismatch', async () => {
  const ports = forfeitDriverPorts({
    claim: vi.fn(),
    release: vi.fn(),
    unclaim: vi.fn().mockResolvedValue('unclaimed_first'),
    markPosting: vi.fn(),
    ackAlert: vi.fn().mockResolvedValue('acked'),
    provider,
    evidence: null,
    operationId,
    expectedDestinationWalletId: 'interest-wallet',
    expectedDestinationOwnerId: 'ogabassey',
  });
  await ports.unclaim(forfeit.operationId, 'check_failed');
  expect(mocks.alert).toHaveBeenCalledWith(
    'PIGGYVEST_GOAL_CANCEL_FORFEIT_UNAVAILABLE',
    { reason: 'interest_wallet_check_failed', operationId }
  );
});

it('pages when a rejected forfeit could not be merged under the ceiling, then acknowledges the reviewed row', async () => {
  const reviewId = '88888888-8888-4888-8888-888888888888';
  const ackAlert = vi.fn().mockResolvedValue('acked');
  const ports = forfeitDriverPorts({
    claim: vi.fn(),
    release: vi.fn().mockResolvedValue(`released_needs_review:${reviewId}`),
    unclaim: vi.fn(),
    markPosting: vi.fn(),
    ackAlert,
    provider,
    evidence: null,
    operationId,
    expectedDestinationWalletId: 'interest-wallet',
    expectedDestinationOwnerId: 'ogabassey',
  });
  expect(await ports.release(forfeit.operationId)).toBe(
    'released_needs_review'
  );
  expect(mocks.alert).toHaveBeenCalledWith(
    'PIGGYVEST_GOAL_CANCEL_FORFEIT_NEEDS_REVIEW',
    { reason: 'forfeit_over_ceiling', operationId }
  );
  // Regression: acknowledged after the page, so the sweep does not page the
  // same review a second time.
  expect(ackAlert).toHaveBeenCalledWith(reviewId);
  expect(mocks.alert.mock.invocationCallOrder[0]).toBeLessThan(
    ackAlert.mock.invocationCallOrder[0]
  );
});

it('acknowledges the third-rejection review on the forfeit itself after paging', async () => {
  const ackAlert = vi.fn().mockResolvedValue('acked');
  const ports = forfeitDriverPorts({
    claim: vi.fn(),
    release: vi.fn().mockResolvedValue('needs_review'),
    unclaim: vi.fn(),
    markPosting: vi.fn(),
    ackAlert,
    provider,
    evidence: null,
    operationId,
    expectedDestinationWalletId: 'interest-wallet',
    expectedDestinationOwnerId: 'ogabassey',
  });
  expect(await ports.release(forfeit.operationId)).toBe('needs_review');
  expect(ackAlert).toHaveBeenCalledWith(forfeit.operationId);
});

it('refuses a wallet that is not owned by the configured Ogabassey owner, even when both wallet settings agree', async () => {
  // Another (non-cancelling) customer's wallet in the same business.
  mocks.retrieve.mockResolvedValue({
    ...ownWallet,
    api_customer_id: 'someone-else',
  });
  for (const owner of ['ogabassey', null]) {
    const ports = forfeitDriverPorts({
      claim: vi.fn(),
      release: vi.fn(),
      unclaim: vi.fn(),
      markPosting: vi.fn(),
      ackAlert: vi.fn().mockResolvedValue('acked'),
      provider,
      evidence: null,
      operationId,
      expectedDestinationWalletId: 'interest-wallet',
      expectedDestinationOwnerId: owner,
    });
    expect(await ports.verifyDestination(forfeit)).toBe(false);
  }
});

describe('bugfix: an alert was marked sent before it was emitted', () => {
  it('acknowledges a stuck claim only after paging, by its forfeit id', async () => {
    const ackAlert = vi.fn().mockResolvedValue('acked');
    const ports = forfeitDriverPorts({
      claim: vi.fn().mockResolvedValue({
        status: 'needs_review',
        forfeitId: forfeit.operationId,
        alert: true,
      }),
      release: vi.fn(),
      unclaim: vi.fn(),
      markPosting: vi.fn(),
      ackAlert,
      provider,
      evidence: null,
      operationId,
      expectedDestinationWalletId: 'interest-wallet',
      expectedDestinationOwnerId: 'ogabassey',
    });
    await ports.claim(operationId);
    expect(ackAlert).toHaveBeenCalledWith(forfeit.operationId);
    expect(mocks.alert.mock.invocationCallOrder[0]).toBeLessThan(
      ackAlert.mock.invocationCallOrder[0]
    );
  });

  it('acknowledges a hand-back page after emitting it', async () => {
    const ackAlert = vi.fn().mockResolvedValue('acked');
    const ports = forfeitDriverPorts({
      claim: vi.fn(),
      release: vi.fn(),
      unclaim: vi.fn().mockResolvedValue('unclaimed_first'),
      markPosting: vi.fn(),
      ackAlert,
      provider,
      evidence: null,
      operationId,
      expectedDestinationWalletId: 'interest-wallet',
      expectedDestinationOwnerId: 'ogabassey',
    });
    await ports.unclaim(forfeit.operationId, 'mismatch');
    expect(ackAlert).toHaveBeenCalledWith(forfeit.operationId);
    expect(mocks.alert.mock.invocationCallOrder[0]).toBeLessThan(
      ackAlert.mock.invocationCallOrder[0]
    );
  });

  it('still answers the claim when the acknowledgement fails (the page repeats)', async () => {
    const claim = {
      status: 'unavailable',
      forfeitId: forfeit.operationId,
      alert: true,
    } as const;
    const ports = forfeitDriverPorts({
      claim: vi.fn().mockResolvedValue(claim),
      release: vi.fn(),
      unclaim: vi.fn(),
      markPosting: vi.fn(),
      ackAlert: vi.fn().mockRejectedValue(new Error('db')),
      provider,
      evidence: null,
      operationId,
      expectedDestinationWalletId: 'interest-wallet',
      expectedDestinationOwnerId: 'ogabassey',
    });
    expect(await ports.claim(operationId)).toEqual(claim);
    expect(mocks.alert).toHaveBeenCalledOnce();
  });
});

describe('bugfix: the interest was sent without checking the goal wallet it comes from', () => {
  it.each([
    ['reassigned to another customer', { api_customer_id: 'someone-else' }],
    ['in another business', { business_id: 'another-business' }],
    ['no longer active', { status: 'frozen' }],
    ['not NGN', { currency: 'USD' }],
    ['holding less than the interest', { balance: 11999 }],
    ['answering for another wallet', { id: 'other-wallet' }],
  ])('refuses to send when the source wallet is %s', async (_why, wrong) => {
    mocks.retrieve.mockImplementation(wallets({ ...goalWallet, ...wrong }));
    const ports = forfeitDriverPorts({
      claim: vi.fn(),
      release: vi.fn(),
      unclaim: vi.fn(),
      markPosting: vi.fn(),
      ackAlert: vi.fn(),
      provider,
      evidence: null,
      operationId,
      expectedDestinationWalletId: 'interest-wallet',
      expectedDestinationOwnerId: 'ogabassey',
    });
    expect(await ports.verifyDestination(forfeit)).toBe(false);
    expect(mocks.retrieve).toHaveBeenCalledWith(provider, 'goal-wallet');
  });
});
