import { describe, expect, it, vi } from 'vitest';
import { createPrefundedCardDispatcher } from './prefunded-card-dispatch';

vi.mock('server-only', () => ({}));

describe('prefunded card dispatcher', () => {
  const request = {
    operationId: '10000000-0000-4000-8000-000000000001',
    integrationId: '10000000-0000-4000-8000-000000000002',
    merchantId: '10000000-0000-4000-8000-000000000003',
    customerId: '10000000-0000-4000-8000-000000000004',
    goalId: '10000000-0000-4000-8000-000000000005',
    treasuryBindingId: '10000000-0000-4000-8000-000000000006',
    businessId: 'business_1',
    sourceWalletId: 'wallet_source',
    destinationWalletId: 'wallet_destination',
    destinationCustomerId: 'customer_destination',
    collectionReference: 'collection-1',
    transferReference: 'transfer-1',
    amountKobo: 100,
    currency: 'NGN' as const,
    savedMethodId: '10000000-0000-4000-8000-000000000007',
  };

  it('passes the complete claimed request to the provider and leaves it dispatching', async () => {
    const store = {
      claimCollection: vi.fn().mockResolvedValue({
        outcome: 'claimed',
        fence: 1,
        operationId: request.operationId,
        request,
      }),
      recordCollection: vi.fn(),
    };
    const provider = {
      submitCollection: vi.fn().mockResolvedValue({
        outcome: 'submitted_for_verification',
      }),
      submitTransfer: vi.fn(),
    };
    const dispatch = createPrefundedCardDispatcher(store as never, provider);
    await expect(
      dispatch.dispatchCollection(request.operationId, 0)
    ).resolves.toEqual({ outcome: 'submitted_for_verification' });
    expect(provider.submitCollection).toHaveBeenCalledWith(request);
    expect(store.recordCollection).not.toHaveBeenCalled();
  });

  it('does not resend a collection when the store refuses an unknown operation claim', async () => {
    const provider = {
      submitCollection: vi.fn(),
      submitTransfer: vi.fn(),
    };
    const dispatch = createPrefundedCardDispatcher(
      {
        claimCollection: vi
          .fn()
          .mockResolvedValue({ outcome: 'stale_or_reconciliation_required' }),
      } as never,
      provider
    );

    await expect(
      dispatch.dispatchCollection(request.operationId, 1)
    ).resolves.toEqual({
      outcome: 'stale_or_reconciliation_required',
    });
    expect(provider.submitCollection).not.toHaveBeenCalled();
  });
});
