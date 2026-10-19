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
    neq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error }),
    limit: vi.fn().mockResolvedValue({ data, error }),
  };
  return query;
}

describe('drainFailedOrderCancellationSideEffects deferred attempts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.run.mockResolvedValue('completed');
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

  it('marks the final failed attempt so rate limits file evidence', async () => {
    const lastAttempt = {
      attempts: 4,
      claimed_at: '2026-07-21T00:00:00Z',
      order_id: 'order-1',
      step: 'refund',
    };
    const freshAttempt = {
      attempts: 1,
      claimed_at: '2026-07-21T00:00:00Z',
      order_id: 'order-2',
      step: 'refund',
    };
    const from = vi
      .fn()
      .mockReturnValueOnce(terminalQuery([lastAttempt, freshAttempt]))
      .mockReturnValueOnce(terminalQuery([]))
      .mockReturnValueOnce(terminalQuery([]))
      .mockReturnValueOnce(
        terminalQuery({ id: 'order-1', merchant_id: 'merchant-1' })
      )
      .mockReturnValueOnce(terminalQuery({ id: 'merchant-1' }))
      .mockReturnValueOnce(
        terminalQuery({ id: 'order-2', merchant_id: 'merchant-1' })
      )
      .mockReturnValueOnce(terminalQuery({ id: 'merchant-1' }));

    await drainFailedOrderCancellationSideEffects({
      sendCancellationEmail: vi.fn(),
      supabase: { from } as never,
    });

    expect(mocks.run).toHaveBeenCalledTimes(2);
    for (const call of mocks.run.mock.calls) {
      await (call[0] as { execute: () => Promise<unknown> }).execute();
    }
    expect(mocks.execute).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ isLastAttempt: true })
    );
    expect(mocks.execute).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ isLastAttempt: false })
    );
  });

  it('marks an already-exhausted deferred row as the last attempt', async () => {
    const deferred = {
      attempts: 4,
      claimed_at: '2026-07-21T00:00:00Z',
      order_id: 'order-1',
      step: 'refund',
    };
    const from = vi
      .fn()
      .mockReturnValueOnce(terminalQuery([]))
      .mockReturnValueOnce(terminalQuery([]))
      .mockReturnValueOnce(terminalQuery([deferred]))
      .mockReturnValueOnce(
        terminalQuery({ id: 'order-1', merchant_id: 'merchant-1' })
      )
      .mockReturnValueOnce(terminalQuery({ id: 'merchant-1' }));

    await drainFailedOrderCancellationSideEffects({
      sendCancellationEmail: vi.fn(),
      supabase: { from } as never,
    });

    expect(mocks.run).toHaveBeenCalledTimes(1);
    await (
      mocks.run.mock.calls[0][0] as { execute: () => Promise<unknown> }
    ).execute();
    // A 429 on this row is recorded as an ordinary failure the capped
    // failed-queue never reselects, so without the flag the leg would
    // disappear without its exhausted-rate-limit review.
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({ isLastAttempt: true })
    );
  });

  it('runs a fresh deferred row as a non-final attempt', async () => {
    const deferred = {
      attempts: 1,
      claimed_at: '2026-07-21T00:00:00Z',
      order_id: 'order-1',
      step: 'refund',
    };
    const from = vi
      .fn()
      .mockReturnValueOnce(terminalQuery([]))
      .mockReturnValueOnce(terminalQuery([]))
      .mockReturnValueOnce(terminalQuery([deferred]))
      .mockReturnValueOnce(
        terminalQuery({ id: 'order-1', merchant_id: 'merchant-1' })
      )
      .mockReturnValueOnce(terminalQuery({ id: 'merchant-1' }));

    await drainFailedOrderCancellationSideEffects({
      sendCancellationEmail: vi.fn(),
      supabase: { from } as never,
    });

    expect(mocks.run).toHaveBeenCalledTimes(1);
    await (
      mocks.run.mock.calls[0][0] as { execute: () => Promise<unknown> }
    ).execute();
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({ isLastAttempt: false })
    );
  });
});
