import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PiggyvestApiError } from './client';
import { submitGoalCancel } from './goal-cancel-transfer';

vi.mock('server-only', () => ({}));

// Owner decision 2026-11-12: an early cancel refunds the saved principal only;
// the interest is forfeited by a separate leg. The split comes from the
// database (splitDispatch); the customer transfer carries the principal.
const request = {
  goalId: '00000000-0000-4000-8000-000000000001',
  operationId: '00000000-0000-4000-8000-000000000002',
};
const reservation = {
  ...request,
  sourceWalletId: 'goal-wallet',
  destinationWalletId: 'main-wallet',
  businessId: 'business',
  providerCustomerId: 'customer',
  reference: 'pvb-cancel-00000000-0000-4000-8000-000000000001',
};
const BALANCE = 262000;
function ports() {
  return {
    reserve: vi.fn().mockResolvedValue({ status: 'claimed', reservation }),
    retrieveWallet: vi.fn(async (id: string) => ({
      id,
      api_customer_id: 'customer',
      business_id: 'business',
      currency: 'NGN',
      status: 'active',
      balance: id === 'goal-wallet' ? BALANCE : 50,
    })),
    claimDispatch: vi.fn().mockResolvedValue(true),
    splitDispatch: vi.fn().mockResolvedValue({
      status: 'dispatched',
      principalKobo: 250000,
      forfeitedInterestKobo: 12000,
    }),
    cancelBeforeDispatch: vi.fn().mockResolvedValue(true),
    lookupTransfer: vi.fn().mockResolvedValue('not_found'),
    releaseAfterRejection: vi.fn().mockResolvedValue(true),
    transfer: vi.fn().mockResolvedValue({ accepted: true }),
  };
}
beforeEach(() => vi.clearAllMocks());

describe('bugfix: an early cancel refunded the interest to the customer', () => {
  it('sends only the principal to the main wallet when the goal earned interest', async () => {
    const p = ports();
    expect(await submitGoalCancel(request, p)).toEqual({ status: 'pending' });
    expect(p.splitDispatch).toHaveBeenCalledWith(request.operationId, BALANCE);
    expect(p.claimDispatch).not.toHaveBeenCalled();
    expect(p.transfer).toHaveBeenCalledOnce();
    expect(p.transfer).toHaveBeenCalledWith({
      reservation,
      amountKobo: 250000,
    });
  });
});

it('looks up a rejected principal transfer under the principal amount', async () => {
  const p = ports();
  p.transfer.mockRejectedValue(
    new PiggyvestApiError('PIGGYVEST_REQUEST_ERROR', 'bad', 422)
  );
  expect(await submitGoalCancel(request, p)).toEqual({ status: 'released' });
  expect(p.lookupTransfer).toHaveBeenCalledWith({
    ...reservation,
    amountKobo: 250000,
  });
});

it.each([
  ['not_claimed', 'pending'],
  ['needs_review', 'needs_review'],
  ['forfeit_unavailable', 'unavailable'],
] as const)('a %s split sends nothing and answers %s', async (status, expected) => {
  const p = ports();
  p.splitDispatch.mockResolvedValue({ status });
  expect(await submitGoalCancel(request, p)).toEqual({ status: expected });
  expect(p.transfer).not.toHaveBeenCalled();
  // The database already released a refused split; nothing more to release.
  expect(p.cancelBeforeDispatch).not.toHaveBeenCalled();
});

it('never sends, and never throws, when the split answers a principal above the balance read', async () => {
  const p = ports();
  p.splitDispatch.mockResolvedValue({
    status: 'dispatched',
    principalKobo: BALANCE + 1,
    forfeitedInterestKobo: 0,
  });
  // The attempt is already dispatched: a throw would strand it, so it is
  // answered needs_review for a person instead.
  expect(await submitGoalCancel(request, p)).toEqual({
    status: 'needs_review',
  });
  expect(p.transfer).not.toHaveBeenCalled();
});
