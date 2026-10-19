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

describe('drainFailedOrderCancellationSideEffects email cutoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.run.mockResolvedValue('completed');
  });

  it('skips an email step without claiming when its sender budget will not fit', async () => {
    const candidate = {
      attempts: 4,
      claimed_at: '2026-07-21T00:00:00Z',
      order_id: 'order-1',
      step: 'customer_email',
    };
    const from = vi
      .fn()
      .mockReturnValueOnce(terminalQuery([candidate]))
      .mockReturnValueOnce(terminalQuery([]))
      .mockReturnValueOnce(terminalQuery([]));
    // 30s left: past the deadline guard but short of the 48s
    // single-attempt sender budget. Claiming would burn the final
    // attempt only for the email to refuse before sending.
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_240_000);

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

  it('admits an email against the separate email cutoff', async () => {
    const candidate = {
      attempts: 1,
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
    // 30s to the side-effect deadline but 56s to the email cutoff
    // (48s sender budget plus the 8s claim allowance): the shared
    // deadline alone would exclude the email at fetch time on every
    // backlog run.
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_240_000);

    try {
      const result = await drainFailedOrderCancellationSideEffects({
        deadlineMs: 1_270_000,
        emailDeadlineMs: 1_296_000,
        sendCancellationEmail: vi.fn(),
        supabase: { from } as never,
      });

      expect(mocks.run).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: 'order-1', step: 'customer_email' })
      );
      expect(result.drained).toEqual([
        { orderId: 'order-1', step: 'customer_email' },
      ]);
    } finally {
      now.mockRestore();
    }
  });
});
