import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PiggyvestApiError } from './client';
import * as savingsTransfer from './primary-wallet-savings-transfer';

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
  reference: 'pvb-save-00000000-0000-4000-8000-000000000002',
};
// A reclaim only happens once the dispatch stamp is older than five
// minutes, so every lookup here is already past the indexing window.
function reclaimedPorts() {
  return {
    reserve: vi.fn().mockResolvedValue({ status: 'pending' }),
    adoptPending: vi
      .fn()
      .mockResolvedValue({ status: 'reclaimed', reservation }),
    lookupTransfer: vi.fn().mockResolvedValue('not_found'),
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
let alerts: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  alerts = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('reclaimed savings dispatch', () => {
  it('never resubmits the same reference when TSQ answers 404', async () => {
    const ports = reclaimedPorts();
    expect(
      await savingsTransfer.submitPrimaryWalletSavingsTransfer(request, ports)
    ).toEqual({ status: 'pending' });
    expect(ports.lookupTransfer).toHaveBeenCalledWith(reservation);
    expect(ports.transfer).not.toHaveBeenCalled();
    expect(ports.claimDispatch).not.toHaveBeenCalled();
    expect(ports.releaseAfterRejection).not.toHaveBeenCalled();
    expect(ports.cancelBeforeDispatch).not.toHaveBeenCalled();
  });

  it('never releases the hold on a 404, even when a retry would be rejected', async () => {
    const ports = reclaimedPorts();
    ports.transfer.mockRejectedValue(
      new PiggyvestApiError('PIGGYVEST_REQUEST_ERROR', 'declined', 200, true)
    );
    expect(
      await savingsTransfer.submitPrimaryWalletSavingsTransfer(request, ports)
    ).toEqual({ status: 'pending' });
    expect(ports.transfer).not.toHaveBeenCalled();
    expect(ports.releaseAfterRejection).not.toHaveBeenCalled();
  });

  it.each([
    'submitted',
    'pending',
    'failed',
    'uncertain',
  ] as const)('never resubmits or releases a reclaimed dispatch observed as %s', async (observed) => {
    const ports = reclaimedPorts();
    ports.lookupTransfer.mockResolvedValue(observed);
    expect(
      await savingsTransfer.submitPrimaryWalletSavingsTransfer(request, ports)
    ).toEqual({ status: 'pending' });
    expect(ports.transfer).not.toHaveBeenCalled();
    expect(ports.releaseAfterRejection).not.toHaveBeenCalled();
  });

  it('holds pending without resubmitting when the lookup itself fails', async () => {
    const ports = reclaimedPorts();
    ports.lookupTransfer.mockRejectedValue(new Error('private lookup'));
    expect(
      await savingsTransfer.submitPrimaryWalletSavingsTransfer(request, ports)
    ).toEqual({ status: 'pending' });
    expect(ports.transfer).not.toHaveBeenCalled();
  });

  it('escalates a reference still not found past the reclaim window to review', async () => {
    const ports = reclaimedPorts();
    expect(
      await savingsTransfer.reviewReclaimedSavingsDispatch(reservation, ports)
    ).toBe('review');
    expect(alerts).toHaveBeenCalledOnce();
    expect(alerts).toHaveBeenCalledWith(
      `[PiggyVest Webhook][ALERT] PIGGYVEST_TRANSFER_NEEDS_REVIEW {"reason":"savings_reference_not_found","operationId":"${reservation.operationId}"}`
    );
    expect(ports.transfer).not.toHaveBeenCalled();
    expect(ports.releaseAfterRejection).not.toHaveBeenCalled();
  });

  it.each([
    'submitted',
    'pending',
    'failed',
    'uncertain',
  ] as const)('keeps a reclaimed dispatch observed as %s pending for reconciliation', async (observed) => {
    const ports = reclaimedPorts();
    ports.lookupTransfer.mockResolvedValue(observed);
    expect(
      await savingsTransfer.reviewReclaimedSavingsDispatch(reservation, ports)
    ).toBe('pending');
    expect(alerts).not.toHaveBeenCalled();
  });
});
