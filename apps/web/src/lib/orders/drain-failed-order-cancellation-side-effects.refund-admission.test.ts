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

  it('claims a refund step even when its verification budget will not fit', async () => {
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
    // One ms short of the 38s verification budget: the claim still
    // runs (it finalizes fully covered rows cheaply), and the budget
    // gates only the post-claim worker run inside the runner.
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_240_000);

    try {
      const deadlineMs = 1_240_000 + REFUND_PREFLIGHT_ADMISSION_BUDGET_MS - 1;
      const result = await drainFailedOrderCancellationSideEffects({
        deadlineMs,
        sendCancellationEmail: vi.fn(),
        supabase: { from } as never,
      });

      expect(mocks.run).toHaveBeenCalledWith(
        expect.objectContaining({
          deadlineMs,
          executeAdmissionBudgetMs: REFUND_PREFLIGHT_ADMISSION_BUDGET_MS,
          orderId: 'order-1',
          step: 'refund',
        })
      );
      expect(result.drained).toEqual([{ orderId: 'order-1', step: 'refund' }]);
    } finally {
      now.mockRestore();
    }
  });

  it('admits a refund at exactly the verification budget boundary', async () => {
    expect(REFUND_PREFLIGHT_ADMISSION_BUDGET_MS).toBe(38_000);
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
      const deadlineMs = 1_240_000 + REFUND_PREFLIGHT_ADMISSION_BUDGET_MS;
      const result = await drainFailedOrderCancellationSideEffects({
        deadlineMs,
        sendCancellationEmail: vi.fn(),
        supabase: { from } as never,
      });

      expect(mocks.run).toHaveBeenCalledWith(
        expect.objectContaining({
          deadlineMs,
          executeAdmissionBudgetMs: REFUND_PREFLIGHT_ADMISSION_BUDGET_MS,
          orderId: 'order-1',
          step: 'refund',
        })
      );
      expect(result.drained).toEqual([{ orderId: 'order-1', step: 'refund' }]);
    } finally {
      now.mockRestore();
    }
  });
});
