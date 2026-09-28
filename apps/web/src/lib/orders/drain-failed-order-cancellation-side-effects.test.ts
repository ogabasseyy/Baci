import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  run: vi.fn(),
}));

vi.mock('@/lib/orders/execute-order-cancellation-side-effect', () => ({
  executeOrderCancellationSideEffect: mocks.execute,
}));
vi.mock('@/lib/orders/run-order-cancellation-side-effect', () => ({
  runOrderCancellationSideEffect: mocks.run,
}));

import { drainFailedOrderCancellationSideEffects } from './drain-failed-order-cancellation-side-effects';

function terminalQuery(data: unknown, error: Error | null = null) {
  const query = {
    eq: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error }),
    limit: vi.fn().mockResolvedValue({ data, error }),
  };
  return query;
}

describe('drainFailedOrderCancellationSideEffects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.run.mockResolvedValue('completed');
  });

  it('claims deterministic failures through the recurring drain', async () => {
    const candidate = {
      claimed_at: '2026-07-21T00:00:00Z',
      order_id: 'order-1',
      step: 'customer_email',
    };
    const from = vi
      .fn()
      .mockReturnValueOnce(terminalQuery([candidate]))
      .mockReturnValueOnce(terminalQuery([]))
      .mockReturnValueOnce(terminalQuery([]))
      .mockReturnValueOnce(
        terminalQuery({
          cancellation_reason: 'Unavailable',
          id: 'order-1',
          merchant_id: 'merchant-1',
        })
      )
      .mockReturnValueOnce(terminalQuery({ id: 'merchant-1' }));

    const result = await drainFailedOrderCancellationSideEffects({
      sendCancellationEmail: vi.fn(),
      supabase: { from } as never,
    });

    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1', step: 'customer_email' })
    );
    expect(result.drained).toEqual([
      { orderId: 'order-1', step: 'customer_email' },
    ]);
  });

  it('stops starting candidates once the invocation deadline passes', async () => {
    const candidate = {
      claimed_at: '2026-07-21T00:00:00Z',
      order_id: 'order-1',
      step: 'refund',
    };
    const from = vi
      .fn()
      .mockReturnValueOnce(terminalQuery([candidate]))
      .mockReturnValueOnce(terminalQuery([]))
      .mockReturnValueOnce(terminalQuery([]));
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_270_000);

    try {
      const result = await drainFailedOrderCancellationSideEffects({
        deadlineMs: 1_270_000,
        sendCancellationEmail: vi.fn(),
        supabase: { from } as never,
      });

      expect(mocks.run).not.toHaveBeenCalled();
      expect(from).toHaveBeenCalledTimes(3);
      expect(result).toEqual({ drained: [], failed: [], skipped: [] });
    } finally {
      now.mockRestore();
    }
  });

  it('fails closed when candidate lookup fails', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(
        terminalQuery(null, new Error('database unavailable'))
      );

    await expect(
      drainFailedOrderCancellationSideEffects({
        sendCancellationEmail: vi.fn(),
        supabase: { from } as never,
      })
    ).rejects.toThrow('cancellation_side_effect_lookup_failed');
  });

  it('quarantines stale claims instead of replaying ambiguous delivery', async () => {
    const stale = {
      claimed_at: '2026-07-21T00:00:00Z',
      order_id: 'order-2',
      step: 'refund',
    };
    const updateQuery = {
      eq: vi.fn(),
      update: vi.fn(),
    };
    updateQuery.update.mockReturnValue(updateQuery);
    updateQuery.eq
      .mockReturnValueOnce(updateQuery)
      .mockReturnValueOnce(updateQuery)
      .mockReturnValueOnce(updateQuery)
      .mockResolvedValueOnce({ error: null });
    const staleQuery = terminalQuery([stale]);
    const from = vi
      .fn()
      .mockReturnValueOnce(terminalQuery([]))
      .mockReturnValueOnce(staleQuery)
      .mockReturnValueOnce(terminalQuery([]))
      .mockReturnValueOnce(updateQuery);

    const result = await drainFailedOrderCancellationSideEffects({
      sendCancellationEmail: vi.fn(),
      supabase: { from } as never,
    });

    expect(mocks.run).not.toHaveBeenCalled();
    expect(staleQuery.lt).toHaveBeenCalledTimes(1);
    expect(staleQuery.lt).toHaveBeenCalledWith(
      'claimed_at',
      expect.any(String)
    );
    expect(updateQuery.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'delivery_uncertain' })
    );
    expect(result.skipped).toEqual([
      {
        orderId: 'order-2',
        reason: 'stale_claim_delivery_uncertain',
        step: 'refund',
      },
    ]);
  });

  it('resumes deferred rows regardless of spent attempts', async () => {
    const candidate = {
      claimed_at: '2026-07-21T00:00:00Z',
      order_id: 'order-1',
      step: 'refund',
    };
    const deferredQuery = terminalQuery([candidate]);
    const from = vi
      .fn()
      .mockReturnValueOnce(terminalQuery([]))
      .mockReturnValueOnce(terminalQuery([]))
      .mockReturnValueOnce(deferredQuery)
      .mockReturnValueOnce(
        terminalQuery({
          id: 'order-1',
          merchant_id: 'merchant-1',
        })
      )
      .mockReturnValueOnce(terminalQuery({ id: 'merchant-1' }));

    const result = await drainFailedOrderCancellationSideEffects({
      sendCancellationEmail: vi.fn(),
      supabase: { from } as never,
    });

    expect(deferredQuery.eq).toHaveBeenCalledWith('status', 'deferred');
    expect(deferredQuery.lt).not.toHaveBeenCalledWith(
      'attempts',
      expect.anything()
    );
    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1', step: 'refund' })
    );
    expect(result.drained).toEqual([{ orderId: 'order-1', step: 'refund' }]);
  });
});
