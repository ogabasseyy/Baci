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

describe('drainFailedOrderCancellationSideEffects candidate selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.run.mockResolvedValue('completed');
  });

  it('runs the oldest candidate across the failed and deferred queues', async () => {
    const failed = {
      attempts: 1,
      claimed_at: '2026-07-22T00:00:00Z',
      order_id: 'order-new',
      step: 'refund',
    };
    const deferred = {
      attempts: 0,
      claimed_at: '2026-07-21T00:00:00Z',
      order_id: 'order-old',
      step: 'refund',
    };
    const from = vi
      .fn()
      .mockReturnValueOnce(terminalQuery([failed]))
      .mockReturnValueOnce(terminalQuery([]))
      .mockReturnValueOnce(terminalQuery([deferred]))
      .mockReturnValueOnce(
        terminalQuery({ id: 'order-old', merchant_id: 'merchant-1' })
      )
      .mockReturnValueOnce(terminalQuery({ id: 'merchant-1' }));

    const summary = await drainFailedOrderCancellationSideEffects({
      limit: 1,
      sendCancellationEmail: vi.fn(),
      supabase: { from } as never,
    });

    // A full failure backlog must not starve older deferred rows: the
    // single slot goes to the oldest candidate regardless of queue.
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-old' })
    );
    expect(summary.drained).toEqual([{ orderId: 'order-old', step: 'refund' }]);
  });

  it('carries the exhausted state into deferred executions', async () => {
    const exhausted = {
      attempts: 5,
      claimed_at: '2026-07-21T00:00:00Z',
      order_id: 'order-deferred',
      step: 'refund',
    };
    const from = vi
      .fn()
      .mockReturnValueOnce(terminalQuery([]))
      .mockReturnValueOnce(terminalQuery([]))
      .mockReturnValueOnce(terminalQuery([exhausted]))
      .mockReturnValueOnce(
        terminalQuery({ id: 'order-deferred', merchant_id: 'merchant-1' })
      )
      .mockReturnValueOnce(terminalQuery({ id: 'merchant-1' }));

    await drainFailedOrderCancellationSideEffects({
      limit: 1,
      sendCancellationEmail: vi.fn(),
      supabase: { from } as never,
    });

    // Without the flag a 429 is recorded as an ordinary failure the
    // capped failed-queue never reselects, losing the leg without its
    // exhausted-rate-limit review.
    const [call] = mocks.run.mock.calls;
    await (call[0] as { execute: () => Promise<unknown> }).execute();
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({ isLastAttempt: true })
    );
  });
});
