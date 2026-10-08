import { describe, expect, it, vi } from 'vitest';
import { reconcilePrimaryWalletSavings } from './primary-wallet-savings-reconciliation';

const operationId = '11111111-1111-4111-8111-111111111111';
const reservation = {
  operationId,
  goalId: '22222222-2222-4222-8222-222222222222',
  amountKobo: 2000,
  sourceWalletId: 'source',
  destinationWalletId: 'destination',
  businessId: 'business',
  providerCustomerId: 'source-customer',
  reference: 'our-reference',
};
function ports() {
  return {
    loadDispatched: vi.fn().mockResolvedValue(reservation),
    queryProvider: vi.fn().mockResolvedValue({
      status: true,
      data: {
        status: 'successful',
        id: 'transaction',
        internal_reference: 'transaction',
        reference: 'provider-reference',
        third_party_reference: 'our-reference',
        amount: 2000,
        fee: 0,
        customer_id: 'source-customer',
        source_wallet: 'source',
        destination_wallet: 'destination',
      },
    }),
    settle: vi.fn().mockResolvedValue('confirmed'),
  };
}
describe('primary savings reconciliation', () => {
  it('queries the stored reference and source, then settles exact provider evidence', async () => {
    const dependencies = ports();
    expect(
      await reconcilePrimaryWalletSavings(operationId, dependencies)
    ).toEqual({ status: 'confirmed' });
    expect(dependencies.queryProvider).toHaveBeenCalledWith({
      reference: 'our-reference',
      walletId: 'source',
    });
    expect(dependencies.settle).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId,
        providerTransactionId: 'transaction',
        amountKobo: 2000,
      })
    );
  });
  it('never queries or settles a reservation for another operation', async () => {
    const dependencies = ports();
    dependencies.loadDispatched.mockResolvedValue({
      ...reservation,
      operationId: reservation.goalId,
    });
    expect(
      await reconcilePrimaryWalletSavings(operationId, dependencies)
    ).toEqual({ status: 'pending' });
    expect(dependencies.queryProvider).not.toHaveBeenCalled();
    expect(dependencies.settle).not.toHaveBeenCalled();
  });
  it('keeps ambiguous provider errors pending without settling or retrying', async () => {
    const dependencies = ports();
    dependencies.queryProvider.mockRejectedValue(
      new Error('private provider error')
    );
    expect(
      await reconcilePrimaryWalletSavings(operationId, dependencies)
    ).toEqual({ status: 'pending' });
    expect(dependencies.queryProvider).toHaveBeenCalledTimes(1);
    expect(dependencies.settle).not.toHaveBeenCalled();
  });
  it('does not credit a bare success or mismatched transaction', async () => {
    const dependencies = ports();
    dependencies.queryProvider.mockResolvedValue({
      status: true,
      data: { status: 'success', amount: 2000 },
    });
    expect(
      await reconcilePrimaryWalletSavings(operationId, dependencies)
    ).toEqual({ status: 'pending' });
    expect(dependencies.settle).not.toHaveBeenCalled();
  });
  it('does not claim confirmation when the atomic settlement is unconfirmed', async () => {
    const dependencies = ports();
    dependencies.settle.mockRejectedValue(new Error('private database error'));
    expect(
      await reconcilePrimaryWalletSavings(operationId, dependencies)
    ).toEqual({ status: 'pending' });
    expect(dependencies.settle).toHaveBeenCalledTimes(1);
  });
});
