import { beforeEach, expect, it, vi } from 'vitest';
import { PiggyvestApiError } from './client';
import { submitPrimaryWalletSavingsTransfer } from './primary-wallet-savings-transfer';

// GL-A: goal funding from the main wallet is gated by the PiggyVest main-wallet
// balance (read from the provider after the database reserves the operation),
// never by the legacy in-house balance. The funding ports carry no legacy
// balance at all, so nothing here can read or debit it.
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
function ports(mainWalletBalanceKobo: number) {
  return {
    reserve: vi.fn().mockResolvedValue({ status: 'claimed', reservation }),
    adoptPending: vi.fn().mockResolvedValue({ status: 'existing' }),
    lookupTransfer: vi.fn().mockResolvedValue('not_found'),
    retrieveWallet: vi.fn(async (id: string) => ({
      id,
      api_customer_id: 'source-customer',
      business_id: 'business',
      currency: 'NGN',
      status: 'active',
      balance: id === 'source' ? mainWalletBalanceKobo : 0,
    })),
    cancelBeforeDispatch: vi.fn().mockResolvedValue(undefined),
    claimDispatch: vi.fn().mockResolvedValue(true),
    releaseAfterRejection: vi.fn().mockResolvedValue(true),
    transfer: vi.fn().mockResolvedValue({ accepted: true }),
  };
}
beforeEach(() => vi.clearAllMocks());

it('funds a goal when the PiggyVest main wallet covers it, reserving with only the request', async () => {
  const dependencies = ports(10000);
  expect(
    await submitPrimaryWalletSavingsTransfer(request, dependencies)
  ).toEqual({ status: 'pending' });
  expect(dependencies.reserve).toHaveBeenCalledTimes(1);
  expect(dependencies.reserve).toHaveBeenCalledWith(request);
  expect(dependencies.retrieveWallet).toHaveBeenCalledWith('source');
  expect(dependencies.claimDispatch).toHaveBeenCalledWith(request.operationId);
  expect(dependencies.transfer).toHaveBeenCalledWith(reservation);
});

it('cancels the reservation and never transfers when the main wallet balance is one kobo short', async () => {
  const dependencies = ports(9999);
  expect(
    await submitPrimaryWalletSavingsTransfer(request, dependencies)
  ).toEqual({ status: 'unavailable' });
  expect(dependencies.cancelBeforeDispatch).toHaveBeenCalledWith(
    request.operationId
  );
  expect(dependencies.claimDispatch).not.toHaveBeenCalled();
  expect(dependencies.transfer).not.toHaveBeenCalled();
});

it('releases the reservation when PiggyVest definitively refuses the wallet transfer for insufficient funds', async () => {
  const dependencies = ports(10000);
  dependencies.transfer.mockRejectedValue(
    new PiggyvestApiError(
      'PIGGYVEST_REQUEST_ERROR',
      'insufficient funds',
      422,
      true
    )
  );
  expect(
    await submitPrimaryWalletSavingsTransfer(request, dependencies)
  ).toEqual({ status: 'cancelled' });
  expect(dependencies.lookupTransfer).toHaveBeenCalledWith(reservation);
  expect(dependencies.releaseAfterRejection).toHaveBeenCalledWith(
    request.operationId
  );
});

it('keeps the reservation pending when the transfer outcome is indeterminate', async () => {
  const dependencies = ports(10000);
  dependencies.transfer.mockRejectedValue(
    new PiggyvestApiError('PIGGYVEST_NETWORK_ERROR', 'timeout')
  );
  expect(
    await submitPrimaryWalletSavingsTransfer(request, dependencies)
  ).toEqual({ status: 'pending' });
  expect(dependencies.releaseAfterRejection).not.toHaveBeenCalled();
  expect(dependencies.cancelBeforeDispatch).not.toHaveBeenCalled();
});

it('does not release when a refusal is followed by a lookup that finds the transfer', async () => {
  const dependencies = ports(10000);
  dependencies.transfer.mockRejectedValue(
    new PiggyvestApiError('PIGGYVEST_REQUEST_ERROR', 'refused', 422, true)
  );
  dependencies.lookupTransfer.mockResolvedValue('uncertain');
  expect(
    await submitPrimaryWalletSavingsTransfer(request, dependencies)
  ).toEqual({ status: 'pending' });
  expect(dependencies.releaseAfterRejection).not.toHaveBeenCalled();
});
