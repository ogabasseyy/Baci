import { describe, expect, it, vi } from 'vitest';
import { adapters, key, lease } from './replay-test-fixtures';
import { createReplayWorker, type ReplayAdapters } from './replay-worker';

const event = {
  eventId: 'accrual-event-1',
  eventType: 'interest-accrued.success',
  eventCategory: 'interest_accrued',
  customer_id: '01M3N0TE6QWPFNPRGVCQG11N1P',
  eventData: {
    id: 'accrual-1',
    wallet_id: 'b7ff9afd-bb88-11f1-a539-42010a9c0026',
    balance: 1650000,
    percentage: 9,
    interest_date: '2026-09-28T00:00:00.000Z',
    amount: 406.8493150684931,
    interest_type: 'original',
  },
  pvb_wallet: '01M3N0TE015JJR1YKBFC2JWZJ9',
  pvb_wallet_name: 'Synthetic customer',
  pvb_split_interest_with_wallet: null,
  pvb_split_interest_with_wallet_name: null,
};

function makeStore(dispatchAccrual?: ReplayAdapters['dispatchAccrual']) {
  return Object.assign(
    adapters({
      claimBatch: async () => [
        lease(event as unknown as Parameters<typeof lease>[0]),
      ],
    }),
    {
      dispatchAccrual,
      dispatchFinancial: vi.fn(async () => 'applied' as const),
    }
  );
}

describe('daily accrual is observation-only, never a paid-interest credit', () => {
  it('passes decrypted raw bytes exclusively to the accrual handler', async () => {
    const dispatch = vi.fn(async () => 'applied' as const);
    const store = makeStore(dispatch);
    const result = await createReplayWorker(store, {
      environment: 'staging',
      batchSize: 1,
      keyResolver: async () => key,
    }).run();
    expect(result.processed).toBe(1);
    expect(dispatch).toHaveBeenCalledWith({
      lease: expect.any(Object),
      raw: Buffer.from(JSON.stringify(event)),
    });
    expect(store.dispatchFinancial).not.toHaveBeenCalled();
    expect(store.dispatch).not.toHaveBeenCalled();
    expect(store.resolveMapping).not.toHaveBeenCalled();
  });

  it('defers missing observation configuration instead of rejecting the provider event or crediting it', async () => {
    const store = makeStore();
    const result = await createReplayWorker(store, {
      environment: 'staging',
      batchSize: 1,
      keyResolver: async () => key,
    }).run();
    expect(result.retryable).toBe(1);
    expect(result.processed).toBe(0);
    expect(result.quarantined).toBe(0);
    expect(store.dispatchFinancial).not.toHaveBeenCalled();
    expect(store.dispatch).not.toHaveBeenCalled();
  });
});
