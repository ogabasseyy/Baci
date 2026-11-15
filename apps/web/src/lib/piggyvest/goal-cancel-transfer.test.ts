import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PiggyvestApiError } from './client';
import { submitGoalCancel } from './goal-cancel-transfer';

vi.mock('server-only', () => ({}));
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
const BALANCE = 123456;
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
    cancelBeforeDispatch: vi.fn().mockResolvedValue(true),
    lookupTransfer: vi.fn().mockResolvedValue('not_found'),
    releaseAfterRejection: vi.fn().mockResolvedValue(true),
    transfer: vi.fn().mockResolvedValue({ accepted: true }),
  };
}
beforeEach(() => vi.clearAllMocks());

it('moves the full balance PiggyVest reports from the goal wallet to the main wallet', async () => {
  const p = ports();
  expect(await submitGoalCancel(request, p)).toEqual({ status: 'pending' });
  expect(p.claimDispatch).toHaveBeenCalledWith(request.operationId, BALANCE);
  expect(p.transfer).toHaveBeenCalledOnce();
  expect(p.transfer).toHaveBeenCalledWith({
    reservation,
    amountKobo: BALANCE,
  });
  // The balance is read from the provider, never derived locally.
  expect(p.retrieveWallet).toHaveBeenCalledWith('goal-wallet');
  expect(p.retrieveWallet).toHaveBeenCalledWith('main-wallet');
});

it.each([
  { status: 'pin_refused', reason: 'missing' },
  { status: 'confirmed' },
  { status: 'conflict' },
  { status: 'expired' },
  { status: 'busy' },
  { status: 'needs_review' },
])('returns %j without touching the provider', async (claim) => {
  const p = ports();
  p.reserve.mockResolvedValue(claim);
  expect(await submitGoalCancel(request, p)).toEqual(claim);
  expect(p.retrieveWallet).not.toHaveBeenCalled();
  expect(p.transfer).not.toHaveBeenCalled();
});

it('never resends a replayed attempt that is already pending', async () => {
  const p = ports();
  p.reserve.mockResolvedValue({ status: 'pending' });
  expect(await submitGoalCancel(request, p)).toEqual({ status: 'pending' });
  expect(p.claimDispatch).not.toHaveBeenCalled();
  expect(p.transfer).not.toHaveBeenCalled();
});

it('refuses a reservation that is not for the requested goal and attempt', async () => {
  const p = ports();
  p.reserve.mockResolvedValue({
    status: 'claimed',
    reservation: {
      ...reservation,
      goalId: '00000000-0000-4000-8000-0000000000ff',
    },
  });
  await expect(submitGoalCancel(request, p)).rejects.toThrow(
    'Goal cancel ownership unavailable'
  );
  expect(p.transfer).not.toHaveBeenCalled();
});

it.each([
  ['a wallet owned by another provider customer', { api_customer_id: 'other' }],
  ['a wallet in another business', { business_id: 'other-business' }],
  ['an inactive wallet', { status: 'frozen' }],
])('cancels before dispatch on %s', async (_name, override) => {
  const p = ports();
  p.retrieveWallet.mockImplementation(async (id: string) => ({
    id,
    api_customer_id: 'customer',
    business_id: 'business',
    currency: 'NGN',
    status: 'active',
    balance: BALANCE,
    ...(id === 'goal-wallet' ? override : {}),
  }));
  expect(await submitGoalCancel(request, p)).toEqual({ status: 'unavailable' });
  expect(p.cancelBeforeDispatch).toHaveBeenCalledWith(request.operationId);
  expect(p.claimDispatch).not.toHaveBeenCalled();
  expect(p.transfer).not.toHaveBeenCalled();
});

it('cancels before dispatch when the provider wallet read fails', async () => {
  const p = ports();
  p.retrieveWallet.mockRejectedValue(new Error('timeout'));
  expect(await submitGoalCancel(request, p)).toEqual({ status: 'unavailable' });
  expect(p.cancelBeforeDispatch).toHaveBeenCalledOnce();
  expect(p.transfer).not.toHaveBeenCalled();
});

it('has nothing to refund when the goal wallet is empty', async () => {
  const p = ports();
  p.retrieveWallet.mockImplementation(async (id: string) => ({
    id,
    api_customer_id: 'customer',
    business_id: 'business',
    currency: 'NGN',
    status: 'active',
    balance: 0,
  }));
  expect(await submitGoalCancel(request, p)).toEqual({ status: 'empty' });
  expect(p.cancelBeforeDispatch).toHaveBeenCalledOnce();
  expect(p.transfer).not.toHaveBeenCalled();
});

it('stays pending without sending when the dispatch claim is lost', async () => {
  const p = ports();
  p.claimDispatch.mockResolvedValue(false);
  expect(await submitGoalCancel(request, p)).toEqual({ status: 'pending' });
  expect(p.transfer).not.toHaveBeenCalled();
});

it('holds pending and never resends after a timeout', async () => {
  const p = ports();
  p.transfer.mockRejectedValue(
    new PiggyvestApiError('PIGGYVEST_NETWORK_ERROR', 'timeout')
  );
  expect(await submitGoalCancel(request, p)).toEqual({ status: 'pending' });
  expect(p.transfer).toHaveBeenCalledOnce();
  expect(p.releaseAfterRejection).not.toHaveBeenCalled();
});

it('releases only after a definitive rejection with no transfer found', async () => {
  const p = ports();
  p.transfer.mockRejectedValue(
    new PiggyvestApiError('PIGGYVEST_REQUEST_ERROR', 'bad', 422)
  );
  expect(await submitGoalCancel(request, p)).toEqual({ status: 'released' });
  expect(p.lookupTransfer).toHaveBeenCalledOnce();
  expect(p.releaseAfterRejection).toHaveBeenCalledWith(request.operationId);
});

it.each([
  'pending',
  'submitted',
  'failed',
  'uncertain',
] as const)('keeps a rejected attempt pending when the lookup says %s', async (lookup) => {
  const p = ports();
  p.transfer.mockRejectedValue(
    new PiggyvestApiError('PIGGYVEST_REQUEST_ERROR', 'bad', 422)
  );
  p.lookupTransfer.mockResolvedValue(lookup);
  expect(await submitGoalCancel(request, p)).toEqual({ status: 'pending' });
  expect(p.releaseAfterRejection).not.toHaveBeenCalled();
});

it('keeps a rejected attempt pending when the lookup itself fails', async () => {
  const p = ports();
  p.transfer.mockRejectedValue(
    new PiggyvestApiError('PIGGYVEST_AUTH_ERROR', 'no', 401)
  );
  p.lookupTransfer.mockRejectedValue(new Error('down'));
  expect(await submitGoalCancel(request, p)).toEqual({ status: 'pending' });
  expect(p.releaseAfterRejection).not.toHaveBeenCalled();
});

it('treats an ambiguous 404 or 5xx from the transfer POST as pending', async () => {
  const p = ports();
  p.transfer.mockRejectedValue(
    new PiggyvestApiError('PIGGYVEST_REQUEST_ERROR', 'oops', 503)
  );
  expect(await submitGoalCancel(request, p)).toEqual({ status: 'pending' });
  expect(p.lookupTransfer).not.toHaveBeenCalled();
});

it('releases the reservation and sends nothing when the balance is above the dispatch ceiling', async () => {
  const p = ports();
  p.retrieveWallet.mockImplementation(async (id: string) => ({
    id,
    api_customer_id: 'customer',
    business_id: 'business',
    currency: 'NGN',
    status: 'active',
    balance: id === 'goal-wallet' ? 10_000_000_000 : 50,
  }));
  expect(await submitGoalCancel(request, p)).toEqual({ status: 'too_large' });
  expect(p.cancelBeforeDispatch).toHaveBeenCalledWith(request.operationId);
  expect(p.claimDispatch).not.toHaveBeenCalled();
  expect(p.transfer).not.toHaveBeenCalled();
});

it('still dispatches a balance exactly at the ceiling', async () => {
  const p = ports();
  p.retrieveWallet.mockImplementation(async (id: string) => ({
    id,
    api_customer_id: 'customer',
    business_id: 'business',
    currency: 'NGN',
    status: 'active',
    balance: id === 'goal-wallet' ? 9_999_999_999 : 50,
  }));
  expect(await submitGoalCancel(request, p)).toEqual({ status: 'pending' });
  expect(p.claimDispatch).toHaveBeenCalledWith(
    request.operationId,
    9_999_999_999
  );
});

describe('bugfix: the ceiling applies to each cancel transfer, not the goal balance', () => {
  const bigWallet = (balance: number) => async (id: string) => ({
    id,
    api_customer_id: 'customer',
    business_id: 'business',
    currency: 'NGN',
    status: 'active',
    balance: id === 'goal-wallet' ? balance : 50,
  });

  it('sends the principal when the balance is above the ceiling but both legs fit', async () => {
    const p = ports();
    p.retrieveWallet.mockImplementation(bigWallet(10_100_000_000));
    const splitDispatch = vi.fn().mockResolvedValue({
      status: 'dispatched',
      principalKobo: 9_900_000_000,
      forfeitedInterestKobo: 200_000_000,
    });
    expect(await submitGoalCancel(request, { ...p, splitDispatch })).toEqual({
      status: 'pending',
    });
    expect(splitDispatch).toHaveBeenCalledWith(
      request.operationId,
      10_100_000_000
    );
    expect(p.transfer).toHaveBeenCalledWith(
      expect.objectContaining({ amountKobo: 9_900_000_000 })
    );
  });

  it('answers too_large, sending nothing, when the database refuses the principal', async () => {
    const p = ports();
    p.retrieveWallet.mockImplementation(bigWallet(10_000_000_001));
    const splitDispatch = vi.fn().mockResolvedValue({ status: 'too_large' });
    expect(await submitGoalCancel(request, { ...p, splitDispatch })).toEqual({
      status: 'too_large',
    });
    expect(p.transfer).not.toHaveBeenCalled();
  });

  it('releases without asking the database for a balance beyond any split', async () => {
    const p = ports();
    p.retrieveWallet.mockImplementation(bigWallet(1_000_000_000_000_000));
    const splitDispatch = vi.fn();
    expect(await submitGoalCancel(request, { ...p, splitDispatch })).toEqual({
      status: 'too_large',
    });
    expect(splitDispatch).not.toHaveBeenCalled();
    expect(p.cancelBeforeDispatch).toHaveBeenCalledWith(request.operationId);
  });
});

// A thrown release must not leave the attempt reserved with the PIN spent
// (funding and new cancels would stay blocked until the stale sweep).
it.each([
  ['the provider wallet read fails', 'unavailable'],
  ['the goal wallet is empty', 'empty'],
  ['the balance is above the ceiling', 'too_large'],
] as const)('retries a thrown release once when %s', async (_why, status) => {
  const p = ports();
  if (status === 'unavailable')
    p.retrieveWallet.mockRejectedValue(new Error('provider down'));
  if (status === 'empty')
    p.retrieveWallet.mockImplementation(async (id: string) => ({
      id,
      api_customer_id: 'customer',
      business_id: 'business',
      currency: 'NGN',
      status: 'active',
      balance: 0,
    }));
  if (status === 'too_large')
    p.retrieveWallet.mockImplementation(async (id: string) => ({
      id,
      api_customer_id: 'customer',
      business_id: 'business',
      currency: 'NGN',
      status: 'active',
      balance: id === 'goal-wallet' ? 10_000_000_000 : 1,
    }));
  p.cancelBeforeDispatch
    .mockRejectedValueOnce(new Error('db blip'))
    .mockResolvedValueOnce(true);
  expect(await submitGoalCancel(request, p)).toEqual({ status });
  expect(p.cancelBeforeDispatch).toHaveBeenCalledTimes(2);
  expect(p.transfer).not.toHaveBeenCalled();
});

it('gives up quietly after two thrown releases and leaves the stale sweep to free it', async () => {
  const p = ports();
  p.retrieveWallet.mockRejectedValue(new Error('provider down'));
  p.cancelBeforeDispatch.mockRejectedValue(new Error('db down'));
  expect(await submitGoalCancel(request, p)).toEqual({ status: 'unavailable' });
  expect(p.cancelBeforeDispatch).toHaveBeenCalledTimes(2);
});

it('does not retry a release the database answered with false', async () => {
  const p = ports();
  p.retrieveWallet.mockRejectedValue(new Error('provider down'));
  p.cancelBeforeDispatch.mockResolvedValue(false);
  await submitGoalCancel(request, p);
  expect(p.cancelBeforeDispatch).toHaveBeenCalledTimes(1);
});
