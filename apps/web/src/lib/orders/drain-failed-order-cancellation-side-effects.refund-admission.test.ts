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
import { REFUND_PREFLIGHT_ADMISSION_BUDGET_MS } from './schedule-preflight-provider-verification';

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

describe('drainFailedOrderCancellationSideEffects refund admission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.run.mockResolvedValue('completed');
  });

  it('skips a refund step without claiming when its verification budget will not fit', async () => {
    const candidate = {
      attempts: 1,
      claimed_at: '2026-07-21T00:00:00Z',
      order_id: 'order-1',
      step: 'refund',
    };
    const from = vi
      .fn()
      .mockReturnValueOnce(terminalQuery([candidate]))
      .mockReturnValueOnce(terminalQuery([]))
      .mockReturnValueOnce(terminalQuery([]));
    // One ms short of the 76s verification budget: claiming would
    // only burn lookups plus a claim for preflight to defer before
    // any provider check. The row stays failed for a tick with room.
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_240_000);

    try {
      const result = await drainFailedOrderCancellationSideEffects({
        deadlineMs: 1_240_000 + REFUND_PREFLIGHT_ADMISSION_BUDGET_MS - 1,
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

  it('admits a refund at exactly the verification budget boundary', async () => {
    expect(REFUND_PREFLIGHT_ADMISSION_BUDGET_MS).toBe(76_000);
    const candidate = {
      attempts: 1,
      claimed_at: '2026-07-21T00:00:00Z',
      order_id: 'order-1',
      step: 'refund',
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
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_240_000);

    try {
      const result = await drainFailedOrderCancellationSideEffects({
        deadlineMs: 1_240_000 + REFUND_PREFLIGHT_ADMISSION_BUDGET_MS,
        sendCancellationEmail: vi.fn(),
        supabase: { from } as never,
      });

      expect(mocks.run).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: 'order-1', step: 'refund' })
      );
      expect(result.drained).toEqual([{ orderId: 'order-1', step: 'refund' }]);
    } finally {
      now.mockRestore();
    }
  });
});
