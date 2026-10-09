import { beforeEach, expect, it, vi } from 'vitest';
import { PiggyvestApiError } from './client';
import { submitPrimaryWalletSavingsTransfer } from './primary-wallet-savings-transfer';

vi.mock('server-only', () => ({}));
const request = {
  goalId: '00000000-0000-4000-8000-000000000001',
  operationId: '00000000-0000-4000-8000-000000000002',
  amountKobo: 10000,
};
const reservation = {
  ...request,
  sourceWalletId: 'source',
  destinationWalletId: 'destination',
  businessId: 'business',
  providerCustomerId: 'source-customer',
  reference: 'stable-reference',
};
function ports() {
  return {
    reserve: vi.fn().mockResolvedValue({ status: 'claimed', reservation }),
    adoptPending: vi.fn().mockResolvedValue({ status: 'existing' }),
    lookupTransfer: vi.fn().mockResolvedValue('absent'),
    retrieveWallet: vi.fn(async (id: string) => ({
      id,
      api_customer_id: 'source-customer',
      business_id: 'business',
      currency: 'NGN',
      status: 'active',
      balance: 10000,
    })),
    cancelBeforeDispatch: vi.fn().mockResolvedValue(undefined),
    claimDispatch: vi.fn().mockResolvedValue(true),
    releaseAfterRejection: vi.fn().mockResolvedValue(true),
    transfer: vi.fn().mockResolvedValue({ accepted: true }),
  };
}
beforeEach(() => vi.clearAllMocks());
it('does not submit again when a durable reservation is already pending', async () => {
  const dependencies = ports();
  dependencies.reserve.mockResolvedValue({ status: 'pending' });
  expect(
    await submitPrimaryWalletSavingsTransfer(request, dependencies)
  ).toEqual({ status: 'pending' });
  expect(dependencies.adoptPending).toHaveBeenCalledWith(request.operationId);
  expect(dependencies.transfer).not.toHaveBeenCalled();
});
it.each([
  'confirmed',
  'insufficient',
  'conflict',
] as const)('returns %s without adopting the stored operation', async (status) => {
  const dependencies = ports();
  dependencies.reserve.mockResolvedValue({ status });
  expect(
    await submitPrimaryWalletSavingsTransfer(request, dependencies)
  ).toEqual({ status });
  expect(dependencies.adoptPending).not.toHaveBeenCalled();
  expect(dependencies.transfer).not.toHaveBeenCalled();
});
it('drives an adopted reservation through claim and transfer', async () => {
  const dependencies = ports();
  dependencies.reserve.mockResolvedValue({ status: 'pending' });
  dependencies.adoptPending.mockResolvedValue({
    status: 'adopted',
    reservation,
  });
  expect(
    await submitPrimaryWalletSavingsTransfer(request, dependencies)
  ).toEqual({ status: 'pending' });
  expect(dependencies.lookupTransfer).not.toHaveBeenCalled();
  expect(dependencies.claimDispatch).toHaveBeenCalledWith(request.operationId);
  expect(dependencies.transfer).toHaveBeenCalledWith(reservation);
});
it('resubmits a reclaimed dispatch only after proving the reference absent', async () => {
  const dependencies = ports();
  dependencies.reserve.mockResolvedValue({ status: 'pending' });
  dependencies.adoptPending.mockResolvedValue({
    status: 'reclaimed',
    reservation,
  });
  expect(
    await submitPrimaryWalletSavingsTransfer(request, dependencies)
  ).toEqual({ status: 'pending' });
  expect(dependencies.lookupTransfer).toHaveBeenCalledWith(reservation);
  expect(dependencies.claimDispatch).not.toHaveBeenCalled();
  expect(dependencies.transfer).toHaveBeenCalledWith(reservation);
});
it.each([
  'submitted',
  'uncertain',
] as const)('never resubmits a reclaimed dispatch observed as %s', async (observed) => {
  const dependencies = ports();
  dependencies.reserve.mockResolvedValue({ status: 'pending' });
  dependencies.adoptPending.mockResolvedValue({
    status: 'reclaimed',
    reservation,
  });
  dependencies.lookupTransfer.mockResolvedValue(observed);
  expect(
    await submitPrimaryWalletSavingsTransfer(request, dependencies)
  ).toEqual({ status: 'pending' });
  expect(dependencies.transfer).not.toHaveBeenCalled();
  expect(dependencies.cancelBeforeDispatch).not.toHaveBeenCalled();
});
it('treats a failed reclaim lookup as uncertain without resubmitting', async () => {
  const dependencies = ports();
  dependencies.reserve.mockResolvedValue({ status: 'pending' });
  dependencies.adoptPending.mockResolvedValue({
    status: 'reclaimed',
    reservation,
  });
  dependencies.lookupTransfer.mockRejectedValue(new Error('private lookup'));
  expect(
    await submitPrimaryWalletSavingsTransfer(request, dependencies)
  ).toEqual({ status: 'pending' });
  expect(dependencies.transfer).not.toHaveBeenCalled();
});
it('holds a reclaimed dispatch pending when wallets no longer verify', async () => {
  const dependencies = ports();
  dependencies.reserve.mockResolvedValue({ status: 'pending' });
  dependencies.adoptPending.mockResolvedValue({
    status: 'reclaimed',
    reservation,
  });
  dependencies.retrieveWallet.mockResolvedValue({
    id: 'source',
    api_customer_id: 'source-customer',
    business_id: 'business',
    currency: 'NGN',
    status: 'active',
    balance: 0,
  });
  expect(
    await submitPrimaryWalletSavingsTransfer(request, dependencies)
  ).toEqual({ status: 'pending' });
  // No rejection signal ran, so no release path exists here: hold for
  // reconcile. The pre-dispatch cancel cannot run after dispatch either.
  expect(dependencies.cancelBeforeDispatch).not.toHaveBeenCalled();
  expect(dependencies.releaseAfterRejection).not.toHaveBeenCalled();
  expect(dependencies.transfer).not.toHaveBeenCalled();
});
it('never accepts a substituted adoption from storage', async () => {
  const dependencies = ports();
  dependencies.reserve.mockResolvedValue({ status: 'pending' });
  dependencies.adoptPending.mockResolvedValue({
    status: 'adopted',
    reservation: { ...reservation, amountKobo: 20000 },
  });
  await expect(
    submitPrimaryWalletSavingsTransfer(request, dependencies)
  ).rejects.toThrow('ownership unavailable');
  expect(dependencies.transfer).not.toHaveBeenCalled();
});
it('does not treat provider acceptance as a completed savings contribution', async () => {
  const dependencies = ports();
  expect(
    await submitPrimaryWalletSavingsTransfer(request, dependencies)
  ).toEqual({ status: 'pending' });
  expect(dependencies.transfer).toHaveBeenCalledOnce();
  expect(dependencies.transfer).toHaveBeenCalledWith(reservation);
});
it('does not retry or release funds after an ambiguous provider failure', async () => {
  const dependencies = ports();
  dependencies.transfer.mockRejectedValue(new Error('Timeout'));
  expect(
    await submitPrimaryWalletSavingsTransfer(request, dependencies)
  ).toEqual({ status: 'pending' });
  expect(dependencies.transfer).toHaveBeenCalledOnce();
  expect(dependencies.cancelBeforeDispatch).not.toHaveBeenCalled();
  expect(dependencies.releaseAfterRejection).not.toHaveBeenCalled();
  expect(dependencies.lookupTransfer).not.toHaveBeenCalled();
});
it.each([
  [
    'auth refusal',
    new PiggyvestApiError('PIGGYVEST_AUTH_ERROR', 'rejected', 401),
  ],
  [
    'missing token',
    new PiggyvestApiError('PIGGYVEST_AUTH_ERROR', 'unconfigured'),
  ],
  [
    'semantic 400',
    new PiggyvestApiError('PIGGYVEST_REQUEST_ERROR', 'bad', 400),
  ],
  [
    'semantic 404',
    new PiggyvestApiError('PIGGYVEST_REQUEST_ERROR', 'gone', 404),
  ],
  [
    'semantic 422',
    new PiggyvestApiError('PIGGYVEST_REQUEST_ERROR', 'invalid', 422),
  ],
  [
    'explicit decline',
    new PiggyvestApiError('PIGGYVEST_REQUEST_ERROR', 'declined', 200, true),
  ],
])('releases a definitively rejected (%s) fresh dispatch proven absent', async (_label, rejection) => {
  const dependencies = ports();
  dependencies.transfer.mockRejectedValue(rejection);
  dependencies.lookupTransfer.mockResolvedValue('absent');
  expect(
    await submitPrimaryWalletSavingsTransfer(request, dependencies)
  ).toEqual({ status: 'cancelled' });
  expect(dependencies.transfer).toHaveBeenCalledOnce();
  expect(dependencies.lookupTransfer).toHaveBeenCalledWith(reservation);
  expect(dependencies.releaseAfterRejection).toHaveBeenCalledWith(
    request.operationId
  );
});
it.each([
  ['rate limit', new PiggyvestApiError('PIGGYVEST_REQUEST_ERROR', 'slow', 429)],
  [
    'server error',
    new PiggyvestApiError('PIGGYVEST_REQUEST_ERROR', 'down', 500),
  ],
  ['conflict', new PiggyvestApiError('PIGGYVEST_REQUEST_ERROR', 'dup', 409)],
  [
    'shape mismatch',
    new PiggyvestApiError('PIGGYVEST_REQUEST_ERROR', 'shape', 200),
  ],
  [
    'decline on 500',
    new PiggyvestApiError('PIGGYVEST_REQUEST_ERROR', 'err', 500, true),
  ],
  ['network', new PiggyvestApiError('PIGGYVEST_NETWORK_ERROR', 'timeout')],
])('holds pending without lookup on ambiguous %s', async (_label, failure) => {
  const dependencies = ports();
  dependencies.transfer.mockRejectedValue(failure);
  expect(
    await submitPrimaryWalletSavingsTransfer(request, dependencies)
  ).toEqual({ status: 'pending' });
  expect(dependencies.releaseAfterRejection).not.toHaveBeenCalled();
  expect(dependencies.lookupTransfer).not.toHaveBeenCalled();
});
it.each([
  'submitted',
  'uncertain',
] as const)('never releases a definitive rejection observed as %s', async (observed) => {
  const dependencies = ports();
  dependencies.transfer.mockRejectedValue(
    new PiggyvestApiError('PIGGYVEST_REQUEST_ERROR', 'invalid', 422)
  );
  dependencies.lookupTransfer.mockResolvedValue(observed);
  expect(
    await submitPrimaryWalletSavingsTransfer(request, dependencies)
  ).toEqual({ status: 'pending' });
  expect(dependencies.releaseAfterRejection).not.toHaveBeenCalled();
});
it('holds pending when the release loses a race after proven absence', async () => {
  const dependencies = ports();
  dependencies.transfer.mockRejectedValue(
    new PiggyvestApiError('PIGGYVEST_REQUEST_ERROR', 'invalid', 422)
  );
  dependencies.lookupTransfer.mockResolvedValue('absent');
  dependencies.releaseAfterRejection.mockResolvedValue(false);
  expect(
    await submitPrimaryWalletSavingsTransfer(request, dependencies)
  ).toEqual({ status: 'pending' });
});
it('releases a reclaimed dispatch definitively rejected while still absent', async () => {
  const dependencies = ports();
  dependencies.reserve.mockResolvedValue({ status: 'pending' });
  dependencies.adoptPending.mockResolvedValue({
    status: 'reclaimed',
    reservation,
  });
  dependencies.lookupTransfer.mockResolvedValue('absent');
  dependencies.transfer.mockRejectedValue(
    new PiggyvestApiError('PIGGYVEST_REQUEST_ERROR', 'declined', 200, true)
  );
  expect(
    await submitPrimaryWalletSavingsTransfer(request, dependencies)
  ).toEqual({ status: 'cancelled' });
  expect(dependencies.transfer).toHaveBeenCalledWith(reservation);
  expect(dependencies.releaseAfterRejection).toHaveBeenCalledWith(
    request.operationId
  );
});
it('cancels before dispatch when the provider source cannot cover the reserved funds', async () => {
  const dependencies = ports();
  dependencies.retrieveWallet.mockResolvedValue({
    id: 'source',
    api_customer_id: 'source-customer',
    business_id: 'business',
    currency: 'NGN',
    status: 'active',
    balance: 0,
  });
  expect(
    await submitPrimaryWalletSavingsTransfer(request, dependencies)
  ).toEqual({ status: 'unavailable' });
  expect(dependencies.cancelBeforeDispatch).toHaveBeenCalledWith(
    request.operationId
  );
  expect(dependencies.claimDispatch).not.toHaveBeenCalled();
  expect(dependencies.transfer).not.toHaveBeenCalled();
});
it('cancels before dispatch when the source wallet belongs to another provider customer', async () => {
  const dependencies = ports();
  dependencies.retrieveWallet.mockImplementation(async (id: string) => ({
    id,
    api_customer_id:
      id === 'source' ? 'foreign-customer' : 'destination-customer',
    business_id: 'business',
    currency: 'NGN',
    status: 'active',
    balance: 10000,
  }));
  expect(
    await submitPrimaryWalletSavingsTransfer(request, dependencies)
  ).toEqual({ status: 'unavailable' });
  expect(dependencies.cancelBeforeDispatch).toHaveBeenCalledWith(
    request.operationId
  );
  expect(dependencies.claimDispatch).not.toHaveBeenCalled();
  expect(dependencies.transfer).not.toHaveBeenCalled();
});
it('never accepts substituted destination or amount from storage', async () => {
  const dependencies = ports();
  dependencies.reserve.mockResolvedValue({
    status: 'claimed',
    reservation: { ...reservation, amountKobo: 20000 },
  });
  await expect(
    submitPrimaryWalletSavingsTransfer(request, dependencies)
  ).rejects.toThrow('ownership unavailable');
  expect(dependencies.transfer).not.toHaveBeenCalled();
});
