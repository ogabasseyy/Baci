import { afterEach, expect, it, vi } from 'vitest';
import { reconcilePrimaryWalletSavings } from './primary-wallet-savings-reconciliation';
import { createSavingsVerifyQueryProvider } from './primary-wallet-savings-reconciliation-runtime';
import { submitPrimaryWalletSavingsTransfer } from './primary-wallet-savings-transfer';
import { lookupSavingsTransferReference } from './primary-wallet-savings-transfer-lookup';
import {
  jsonResponse,
  liveJustSubmittedNotFound,
  liveTransactionStatus,
} from './transaction-status-live.test-support';

// Live sandbox, 2026-10-31 (proof p2): a 202-accepted wallet transfer
// answers TSQ 404, then pending, then successful. The stale-dispatch
// reclaim lands inside that window, so its lookup sees the 404 too.
const operationId = '00000000-0000-4000-8000-000000000002';
const reservation = {
  operationId,
  goalId: '00000000-0000-4000-8000-000000000001',
  amountKobo: 10000,
  sourceWalletId: '01JBSYNTHETICSOURCEWALLET1',
  destinationWalletId: '01JBSYNTHETICGOALWALLET001',
  reference: `pvb-save-${operationId}`,
  businessId: 'business',
  providerCustomerId: '01JBSYNTHETICCUSTOMER00001',
};
const binding = { ...reservation, customerId: reservation.providerCustomerId };

afterEach(() => vi.restoreAllMocks());

function liveSandbox() {
  const answers = ['not_found', 'not_found', 'pending', 'successful'] as const;
  let served = 0;
  const fetchImplementation = vi.fn(async () => {
    const answer = answers[Math.min(served, answers.length - 1)];
    served += 1;
    return answer === 'not_found'
      ? jsonResponse(liveJustSubmittedNotFound, 404)
      : jsonResponse(liveTransactionStatus(binding, answer));
  });
  return { fetchImplementation, served: () => served };
}

function submissionPorts(fetchImplementation: typeof fetch) {
  return {
    reserve: vi
      .fn()
      .mockResolvedValueOnce({ status: 'claimed', reservation })
      .mockResolvedValue({ status: 'pending' }),
    // The client retries after the five-minute dispatch lease went stale.
    adoptPending: vi
      .fn()
      .mockResolvedValue({ status: 'reclaimed', reservation }),
    lookupTransfer: async (selected: typeof reservation) =>
      await lookupSavingsTransferReference({
        reference: selected.reference,
        walletId: selected.sourceWalletId,
        amountKobo: selected.amountKobo,
        destinationWalletId: selected.destinationWalletId,
        token: 'synthetic-token',
        baseUrl: 'https://staging.piggyvest.business',
        fetchImplementation,
      }),
    retrieveWallet: vi.fn(async (id: string) => ({
      id,
      api_customer_id: reservation.providerCustomerId,
      business_id: reservation.businessId,
      currency: 'NGN',
      status: 'active',
      balance: 50000,
    })),
    cancelBeforeDispatch: vi.fn().mockResolvedValue(undefined),
    claimDispatch: vi.fn().mockResolvedValue(true),
    releaseAfterRejection: vi.fn().mockResolvedValue(true),
    // The provider accepts the single POST with 202 processing.
    transfer: vi.fn().mockResolvedValue({ accepted: true }),
  };
}

function reconciliationPorts(fetchImplementation: typeof fetch) {
  return {
    loadDispatched: vi.fn().mockResolvedValue(reservation),
    queryProvider: createSavingsVerifyQueryProvider({
      environment: 'staging',
      token: 'synthetic-token',
      fetchImplementation,
    }),
    settle: vi.fn().mockResolvedValue('confirmed'),
    release: vi.fn().mockResolvedValue('released'),
  };
}

it('settles a transfer whose TSQ answers 404, then pending, then successful once, with exactly one POST', async () => {
  const alerts = vi.spyOn(console, 'error').mockImplementation(() => {});
  const provider = liveSandbox();
  const submission = submissionPorts(provider.fetchImplementation);
  const reconciliation = reconciliationPorts(provider.fetchImplementation);
  const request = {
    goalId: reservation.goalId,
    operationId,
    amountKobo: reservation.amountKobo,
  };

  expect(await submitPrimaryWalletSavingsTransfer(request, submission)).toEqual(
    { status: 'pending' }
  );
  // Immediately after the 202: TSQ 404 is "not indexed yet", not failure.
  expect(
    await reconcilePrimaryWalletSavings(operationId, reconciliation)
  ).toEqual({ status: 'pending' });
  // The stale-dispatch reclaim still sees 404 and must not re-POST.
  expect(await submitPrimaryWalletSavingsTransfer(request, submission)).toEqual(
    { status: 'pending' }
  );
  expect(
    await reconcilePrimaryWalletSavings(operationId, reconciliation)
  ).toEqual({ status: 'pending' });
  expect(
    await reconcilePrimaryWalletSavings(operationId, reconciliation)
  ).toEqual({ status: 'confirmed' });

  expect(provider.served()).toBe(4);
  expect(submission.transfer).toHaveBeenCalledOnce();
  expect(reconciliation.settle).toHaveBeenCalledOnce();
  expect(reconciliation.settle).toHaveBeenCalledWith(
    expect.objectContaining({
      status: 'verified',
      reference: reservation.reference,
      amountKobo: reservation.amountKobo,
    })
  );
  expect(reconciliation.release).not.toHaveBeenCalled();
  // Only the reclaim, already past the five-minute lease, raises review.
  expect(alerts).toHaveBeenCalledOnce();
  expect(alerts).toHaveBeenCalledWith(
    `[PiggyVest Webhook][ALERT] PIGGYVEST_TRANSFER_NEEDS_REVIEW {"reason":"savings_reference_not_found","operationId":"${operationId}"}`
  );
  expect(submission.releaseAfterRejection).not.toHaveBeenCalled();
  expect(submission.cancelBeforeDispatch).not.toHaveBeenCalled();
});
