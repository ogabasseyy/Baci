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

describe('drainFailedOrderCancellationSideEffects refund admission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.run.mockResolvedValue('completed');
  });

  it('runs a refund step with no budget gate of its own', async () => {
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
    // One ms of budget left: the claim still runs (it finalizes
    // fully covered rows cheaply) and cheap worker paths like
    // unsupported-gateway quarantine still execute. The verification
    // budget is enforced inside the worker run only once a leg
    // needing provider verification is scheduled.
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_240_000);

    try {
      const result = await drainFailedOrderCancellationSideEffects({
        deadlineMs: 1_240_001,
        sendCancellationEmail: vi.fn(),
        supabase: { from } as never,
      });

      expect(mocks.run).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: 'order-1', step: 'refund' })
      );
      expect(mocks.run.mock.calls[0][0]).not.toHaveProperty(
        'executeAdmissionBudgetMs'
      );
      expect(result.drained).toEqual([{ orderId: 'order-1', step: 'refund' }]);
    } finally {
      now.mockRestore();
    }
  });

  it('runs a refund against the separate refund cutoff', async () => {
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
        deadlineMs: 1_270_000,
        refundDeadlineMs: 1_296_000,
        sendCancellationEmail: vi.fn(),
        supabase: { from } as never,
      });

      expect(mocks.run).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: 'order-1', step: 'refund' })
      );
      // The mocked runner never invokes the closure: call through
      // to prove the refund cutoff (not the shared deadline) reaches
      // the executor's verification budget.
      const runArg = mocks.run.mock.calls[0]?.[0] as {
        execute: () => Promise<unknown>;
      };
      await runArg.execute();
      expect(mocks.execute).toHaveBeenCalledWith(
        expect.objectContaining({ deadlineMs: 1_296_000 })
      );
      expect(result.drained).toEqual([{ orderId: 'order-1', step: 'refund' }]);
    } finally {
      now.mockRestore();
    }
  });
});
