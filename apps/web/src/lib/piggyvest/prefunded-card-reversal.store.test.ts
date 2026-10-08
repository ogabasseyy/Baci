import { describe, expect, it, vi } from 'vitest';
import { prefundedCardProviderTestFixture as fixture } from './prefunded-card-provider.test-fixture';
import { createPrefundedCardReversalStore } from './prefunded-card-reversal.store';

vi.mock('server-only', () => ({}));

const command = {
  operationId: fixture.claim.operationId,
  integrationId: fixture.claim.integrationId,
  merchantId: fixture.claim.merchantId,
  customerId: fixture.claim.customerId,
  goalId: fixture.claim.goalId,
  treasuryBindingId: fixture.claim.treasuryBindingId,
  savedMethodId: fixture.claim.savedMethodId,
  eventId: 'delivery-1',
  collectionReference: fixture.claim.collectionReference,
  collectionTransactionId: '123',
  collectionAmountKobo: 5000,
  currency: 'NGN',
  providerStatus: 'reversed',
  domain: 'test',
};

describe('reversal SQL adapter boundaries', () => {
  it('rejects an acknowledgement for a different operation or event', async () => {
    for (const changed of [
      { operationId: fixture.claim.goalId },
      { eventId: 'other' },
    ]) {
      const execute = vi.fn().mockResolvedValue({
        rows: [
          {
            result: {
              operationId: command.operationId,
              eventId: command.eventId,
              outcome: 'recorded',
              obligation: 'review_required',
              exposure: 'transfer_completed',
              ...changed,
            },
          },
        ],
      });
      const store = createPrefundedCardReversalStore(execute, '123');
      await expect(store.recordReversal(command)).rejects.toThrow(
        'Prefunded reversal unavailable'
      );
    }
  });

  it('accepts exact idempotent replay receipts', async () => {
    const receipt = {
      operationId: command.operationId,
      eventId: command.eventId,
      outcome: 'duplicate',
      obligation: 'review_required',
      exposure: 'transfer_completed',
    };
    const store = createPrefundedCardReversalStore(
      vi.fn().mockResolvedValue({ rows: [{ result: receipt }] }),
      '123'
    );
    await expect(store.recordReversal(command)).resolves.toEqual(receipt);
  });

  it('rejects invalid evidence before SQL and redacts database errors', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('secret query body'));
    const store = createPrefundedCardReversalStore(execute, '123');
    await expect(
      store.recordReversal({ ...command, collectionAmountKobo: -1 })
    ).rejects.toThrow('Prefunded reversal unavailable');
    expect(execute).not.toHaveBeenCalled();
    await expect(store.recordReversal(command)).rejects.toThrow(
      'Prefunded reversal unavailable'
    );
  });

  it('rejects a context for a different operation', async () => {
    const store = createPrefundedCardReversalStore(
      vi.fn().mockResolvedValue({
        rows: [
          {
            result: {
              request: { ...fixture.claim, operationId: fixture.claim.goalId },
              collectionTransactionId: '123',
            },
          },
        ],
      }),
      '123'
    );
    await expect(store.readContext(command.operationId)).rejects.toThrow(
      'Prefunded reversal unavailable'
    );
  });
});
