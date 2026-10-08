import { beforeEach, expect, it, vi } from 'vitest';
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
