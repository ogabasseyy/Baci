import { beforeEach, expect, it, vi } from 'vitest';
import { PiggyvestApiError } from './client';
import {
  sweepGoalCancelForfeit,
  withGoalCancelAmounts,
} from './goal-cancel-forfeit-runtime';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  transfer: vi.fn(),
  lookup: vi.fn(),
  reconcile: vi.fn(),
  alert: vi.fn(),
}));
vi.mock('./transfers', () => ({ transferToWallet: mocks.transfer }));
vi.mock('./primary-wallet-savings-transfer-lookup', () => ({
  lookupSavingsTransferReference: mocks.lookup,
}));
vi.mock('./goal-cancel-forfeit-reconciliation', () => ({
  runGoalCancelForfeitReconciliation: mocks.reconcile,
}));
vi.mock('./webhook-alerts', () => ({ emitPiggyvestWebhookAlert: mocks.alert }));

const operationId = '66666666-6666-4666-8666-666666666666';
const goalId = '55555555-5555-4555-8555-555555555555';
const forfeit = {
  operationId: '77777777-7777-4777-8777-777777777777',
  goalId,
  amountKobo: 12000,
  sourceWalletId: 'goal-wallet',
  destinationWalletId: 'interest-wallet',
  reference: `pvb-forfeit-${goalId}`,
  businessId: 'business',
  providerCustomerId: 'customer',
};
const provider = { token: 'token', baseUrl: 'https://example.test' };
function store(claim: unknown) {
  return {
    claimForfeit: vi.fn().mockResolvedValue(claim),
    releaseForfeit: vi.fn().mockResolvedValue('needs_review'),
    readAmounts: vi
      .fn()
      .mockResolvedValue({ principalKobo: 1, forfeitedInterestKobo: 0 }),
  } as never;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.transfer.mockResolvedValue({ accepted: true });
  mocks.reconcile.mockResolvedValue({ status: 'confirmed' });
});

it('sends the interest to the interest wallet and settles it through the evidence login', async () => {
  expect(
    await sweepGoalCancelForfeit({
      store: store({ status: 'claimed', forfeit }),
      provider,
      evidence: { integrationId: 'i' },
      operationId,
    })
  ).toBe('confirmed');
  expect(mocks.transfer).toHaveBeenCalledWith(provider, {
    amountKobo: 12000,
    sourceWalletId: 'goal-wallet',
    destinationWalletId: 'interest-wallet',
    reference: forfeit.reference,
    narration: 'Savings goal cancelled early: interest forfeited',
  });
});

it('stays pending without an evidence binding', async () => {
  expect(
    await sweepGoalCancelForfeit({
      store: store({ status: 'claimed', forfeit }),
      provider,
      evidence: null,
      operationId,
    })
  ).toBe('pending');
  expect(mocks.reconcile).not.toHaveBeenCalled();
});

it.each([
  ['needs_review', 'PIGGYVEST_GOAL_CANCEL_FORFEIT_NEEDS_REVIEW'],
  ['unavailable', 'PIGGYVEST_GOAL_CANCEL_FORFEIT_UNAVAILABLE'],
] as const)('pages a person the first time the forfeit is %s', async (status, code) => {
  await sweepGoalCancelForfeit({
    store: store({ status, alert: true }),
    provider,
    evidence: null,
    operationId,
  });
  expect(mocks.alert).toHaveBeenCalledWith(
    code,
    expect.objectContaining({ operationId })
  );
  expect(mocks.transfer).not.toHaveBeenCalled();
});

it.each([
  'needs_review',
  'unavailable',
] as const)('does not page again when a %s forfeit was already reported', async (status) => {
  expect(
    await sweepGoalCancelForfeit({
      store: store({ status }),
      provider,
      evidence: null,
      operationId,
    })
  ).toBe(status);
  expect(mocks.alert).not.toHaveBeenCalled();
});

it('never throws: a failing database answers failed', async () => {
  const failing = {
    claimForfeit: vi.fn().mockRejectedValue(new Error('db')),
  } as never;
  expect(
    await sweepGoalCancelForfeit({
      store: failing,
      provider,
      evidence: null,
      operationId,
    })
  ).toBe('failed');
});

it('attaches the server amounts only to answers with a dispatched attempt behind them', async () => {
  const s = store(null);
  expect(
    await withGoalCancelAmounts(s, operationId, { status: 'confirmed' })
  ).toEqual({
    status: 'confirmed',
    amounts: { principalKobo: 1, forfeitedInterestKobo: 0 },
  });
  expect(
    await withGoalCancelAmounts(s, operationId, { status: 'released' })
  ).toEqual({
    status: 'released',
  });
});

it('pages once when the third rejected forfeit is capped into review', async () => {
  mocks.transfer.mockRejectedValue(
    new PiggyvestApiError('PIGGYVEST_REQUEST_ERROR', 'bad', 422)
  );
  mocks.lookup.mockResolvedValue('not_found');
  expect(
    await sweepGoalCancelForfeit({
      store: store({ status: 'claimed', forfeit }),
      provider,
      evidence: null,
      operationId,
    })
  ).toBe('needs_review');
  expect(mocks.alert).toHaveBeenCalledOnce();
  expect(mocks.alert).toHaveBeenCalledWith(
    'PIGGYVEST_GOAL_CANCEL_FORFEIT_NEEDS_REVIEW',
    { reason: 'forfeit_rejected_three_times', operationId }
  );
});
