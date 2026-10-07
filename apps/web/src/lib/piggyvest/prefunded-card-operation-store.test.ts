import { describe, expect, it, vi } from 'vitest';
import { createPrefundedCardOperationStore } from './prefunded-card-operation-store';

vi.mock('server-only', () => ({}));

describe('prefunded card operation store', () => {
  it('refuses a mismatched read identity and unknown projection acknowledgement', async () => {
    const operationId = '10000000-0000-4000-8000-000000000001';
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            result: {
              operationId: '10000000-0000-4000-8000-000000000002',
              collectionStatus: 'not_started',
              transferStatus: 'not_started',
              projectionStatus: 'unapplied',
              collectionFence: 0,
              transferFence: 0,
            },
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ result: 'ok' }] });
    const store = createPrefundedCardOperationStore(execute);
    await expect(store.readOperation(operationId, '12345')).rejects.toThrow(
      'Prefunded card store unavailable'
    );
    await expect(store.project(operationId, '12345')).rejects.toThrow(
      'Prefunded card store unavailable'
    );
  });

  it('refuses invalid physical identity before executing a read or projection', async () => {
    const execute = vi.fn();
    const store = createPrefundedCardOperationStore(execute);
    for (const method of ['readOperation', 'project'] as const) {
      await expect(
        store[method]('10000000-0000-4000-8000-000000000001', 'wrong')
      ).rejects.toThrow('Prefunded card store unavailable');
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    'claimCollection',
    'claimTransfer',
  ] as const)('rejects a cross-operation or stale %s acknowledgement', async (method) => {
    const expectedId = '10000000-0000-4000-8000-000000000001';
    const request = {
      operationId: expectedId,
      integrationId: expectedId,
      merchantId: expectedId,
      customerId: expectedId,
      goalId: expectedId,
      treasuryBindingId: expectedId,
      businessId: 'business',
      sourceWalletId: 'treasury',
      collectionReference: 'collection',
      transferReference: 'transfer',
      amountKobo: 100,
      currency: 'NGN',
      savedMethodId: expectedId,
      destinationWalletId: 'wallet',
      destinationCustomerId: 'customer',
    };
    for (const identity of [
      { operationId: '10000000-0000-4000-8000-000000000002', fence: 1 },
      { operationId: expectedId, fence: 2 },
    ]) {
      const execute = vi.fn().mockResolvedValue({
        rows: [{ result: { outcome: 'claimed', ...identity, request } }],
      });
      await expect(
        createPrefundedCardOperationStore(execute)[method](expectedId, 0)
      ).rejects.toThrow('Prefunded card store unavailable');
    }
    const execute = vi.fn().mockResolvedValue({
      rows: [
        {
          result: {
            outcome: 'claimed',
            operationId: expectedId,
            fence: 1,
            request,
          },
        },
      ],
    });
    await expect(
      createPrefundedCardOperationStore(execute)[method](expectedId, 0)
    ).resolves.toMatchObject({ outcome: 'claimed', fence: 1 });
  });

  it('rejects an invalid reserve command before opening the database executor', async () => {
    const execute = vi.fn();
    const store = createPrefundedCardOperationStore(execute);
    await expect(store.reserve({})).rejects.toThrow(
      'Prefunded card store unavailable'
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects invalid recovery lease, leg, outcome, and evidence before the executor', async () => {
    const execute = vi.fn();
    const store = createPrefundedCardOperationStore(execute);
    await expect(
      store.claimReconciliation('10000000-0000-4000-8000-000000000001', 0)
    ).rejects.toThrow('Prefunded card store unavailable');
    await expect(
      store.completeReconciliation(
        '10000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000002',
        1,
        'invalid',
        'invalid',
        null
      )
    ).rejects.toThrow('Prefunded card store unavailable');
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects a mismatched persisted acknowledgement', async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [
        {
          result: {
            operationId: '10000000-0000-4000-8000-000000000009',
            outcome: 'reserved',
            collectionStatus: 'not_started',
            transferStatus: 'not_started',
          },
        },
      ],
    });
    const store = createPrefundedCardOperationStore(execute);
    await expect(
      store.reserve({
        operationId: '10000000-0000-4000-8000-000000000001',
        integrationId: '10000000-0000-4000-8000-000000000002',
        merchantId: '10000000-0000-4000-8000-000000000003',
        customerId: '10000000-0000-4000-8000-000000000004',
        goalId: '10000000-0000-4000-8000-000000000005',
        treasuryBindingId: '10000000-0000-4000-8000-000000000006',
        requestFingerprint: '1234567890123456',
        idempotencyKey: 'abcdefghijklmnop',
        savedMethodId: '10000000-0000-4000-8000-000000000007',
        amountKobo: 1,
        feeAllowanceKobo: 0,
        currency: 'NGN',
        collectionReference: 'collection-1',
        transferReference: 'transfer-1',
        destinationWalletId: 'wallet',
        destinationCustomerId: 'customer',
      })
    ).rejects.toThrow('Prefunded card store unavailable');
  });
  it('uses only the reservation and fenced transfer SQL entry points', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            result: {
              operationId: '10000000-0000-4000-8000-000000000001',
              outcome: 'reserved',
              collectionStatus: 'not_started',
              transferStatus: 'not_started',
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ result: { outcome: 'stale_or_reconciliation_required' } }],
      });
    const store = createPrefundedCardOperationStore(execute);
    await expect(
      store.reserve({
        operationId: '10000000-0000-4000-8000-000000000001',
        integrationId: '10000000-0000-4000-8000-000000000002',
        merchantId: '10000000-0000-4000-8000-000000000003',
        customerId: '10000000-0000-4000-8000-000000000004',
        goalId: '10000000-0000-4000-8000-000000000005',
        treasuryBindingId: '10000000-0000-4000-8000-000000000006',
        requestFingerprint: '1234567890123456',
        idempotencyKey: 'abcdefghijklmnop',
        savedMethodId: '10000000-0000-4000-8000-000000000007',
        amountKobo: 1,
        feeAllowanceKobo: 0,
        currency: 'NGN',
        collectionReference: 'collection-1',
        transferReference: 'transfer-1',
        destinationWalletId: 'wallet',
        destinationCustomerId: 'customer',
      })
    ).resolves.toMatchObject({ outcome: 'reserved' });
    await expect(
      store.claimCollection('10000000-0000-4000-8000-000000000001', 0)
    ).resolves.toEqual({ outcome: 'stale_or_reconciliation_required' });
    expect(execute.mock.calls[1]?.[0]).toBe(
      'SELECT prefunded_card.claim_collection($1::uuid,$2::bigint) AS result'
    );
  });
});
