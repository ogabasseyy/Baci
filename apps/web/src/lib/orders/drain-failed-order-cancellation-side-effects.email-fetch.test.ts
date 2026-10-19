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

describe('drainFailedOrderCancellationSideEffects email fetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.run.mockResolvedValue('completed');
  });

  it('fills the batch past a budget-ineligible email instead of starving refunds', async () => {
    const email = {
      attempts: 1,
      claimed_at: '2026-07-21T00:00:00Z',
      order_id: 'order-1',
      step: 'customer_email',
    };
    const refund = {
      attempts: 1,
      claimed_at: '2026-07-22T00:00:00Z',
      order_id: 'order-2',
      step: 'refund',
    };
    const from = vi
      .fn()
      .mockReturnValueOnce(terminalQuery([email, refund]))
      .mockReturnValueOnce(terminalQuery([]))
      .mockReturnValueOnce(terminalQuery([]))
      .mockReturnValueOnce(
        terminalQuery({ id: 'order-2', merchant_id: 'merchant-2' })
      )
      .mockReturnValueOnce(terminalQuery({ id: 'merchant-2' }));
    // One slot left: the older email cannot meet its 48s sender
    // budget on its 30s clock, so the refund — with room on its own
    // 80s clock — must take the slot instead of the batch going out
    // empty every invocation.
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_240_000);

    try {
      const result = await drainFailedOrderCancellationSideEffects({
        deadlineMs: 1_320_000,
        emailDeadlineMs: 1_270_000,
        limit: 1,
        sendCancellationEmail: vi.fn(),
        supabase: { from } as never,
      });

      expect(mocks.run).toHaveBeenCalledTimes(1);
      expect(mocks.run).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: 'order-2', step: 'refund' })
      );
      expect(result.drained).toEqual([{ orderId: 'order-2', step: 'refund' }]);
    } finally {
      now.mockRestore();
    }
  });

  it('excludes emails from the fetch when the admission budget is already short', async () => {
    const refund = {
      attempts: 1,
      claimed_at: '2026-07-22T00:00:00Z',
      order_id: 'order-2',
      step: 'refund',
    };
    // With limit 1 and an older email ahead of this refund, the
    // unfiltered SQL fetch would return only the email and the batch
    // would go out empty on every invocation; the exclusion lets the
    // database return the refund instead.
    const failedQuery = terminalQuery([refund]);
    const deferredQuery = terminalQuery([]);
    const staleQuery = terminalQuery([]);
    const from = vi
      .fn()
      .mockReturnValueOnce(failedQuery)
      .mockReturnValueOnce(staleQuery)
      .mockReturnValueOnce(deferredQuery)
      .mockReturnValueOnce(
        terminalQuery({ id: 'order-2', merchant_id: 'merchant-2' })
      )
      .mockReturnValueOnce(terminalQuery({ id: 'merchant-2' }));
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_240_000);

    try {
      const result = await drainFailedOrderCancellationSideEffects({
        deadlineMs: 1_320_000,
        emailDeadlineMs: 1_270_000,
        limit: 1,
        sendCancellationEmail: vi.fn(),
        supabase: { from } as never,
      });

      expect(failedQuery.neq).toHaveBeenCalledWith('step', 'customer_email');
      expect(deferredQuery.neq).toHaveBeenCalledWith('step', 'customer_email');
      // Stale-claim terminalization is budget-independent.
      expect(staleQuery.neq).not.toHaveBeenCalled();
      expect(mocks.run).toHaveBeenCalledTimes(1);
      expect(mocks.run).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: 'order-2', step: 'refund' })
      );
      expect(result.drained).toEqual([{ orderId: 'order-2', step: 'refund' }]);
    } finally {
      now.mockRestore();
    }
  });

  it('fetches emails normally when the admission budget fits', async () => {
    const email = {
      attempts: 1,
      claimed_at: '2026-07-21T00:00:00Z',
      order_id: 'order-1',
      step: 'customer_email',
    };
    const failedQuery = terminalQuery([email]);
    const from = vi
      .fn()
      .mockReturnValueOnce(failedQuery)
      .mockReturnValueOnce(terminalQuery([]))
      .mockReturnValueOnce(terminalQuery([]))
      .mockReturnValueOnce(
        terminalQuery({ id: 'order-1', merchant_id: 'merchant-1' })
      )
      .mockReturnValueOnce(terminalQuery({ id: 'merchant-1' }));
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_200_000);

    try {
      const result = await drainFailedOrderCancellationSideEffects({
        deadlineMs: 1_270_000,
        limit: 1,
        sendCancellationEmail: vi.fn(),
        supabase: { from } as never,
      });

      expect(failedQuery.neq).not.toHaveBeenCalled();
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

  it('skips an email without claiming when lookups burn the send margin', async () => {
    const email = {
      attempts: 4,
      claimed_at: '2026-07-21T00:00:00Z',
      order_id: 'order-1',
      step: 'customer_email',
    };
    const failedQuery = terminalQuery([email]);
    const from = vi
      .fn()
      .mockReturnValueOnce(failedQuery)
      .mockReturnValueOnce(terminalQuery([]))
      .mockReturnValueOnce(terminalQuery([]))
      .mockReturnValueOnce(
        terminalQuery({ id: 'order-1', merchant_id: 'merchant-1' })
      )
      .mockReturnValueOnce(terminalQuery({ id: 'merchant-1' }));
    // 70s at admission, then 49s after the order/merchant reads: above
    // the 48s send threshold the old code claimed on, but short of the
    // send-plus-claim budget, so claiming would burn the final attempt
    // on an admission refusal. Calls: fetch exclusion, stale cutoff,
    // batch fill, deadline guard, pre-read backstop, post-read recheck.
    const now = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(1_200_000)
      .mockReturnValueOnce(1_200_000)
      .mockReturnValueOnce(1_200_000)
      .mockReturnValueOnce(1_200_000)
      .mockReturnValueOnce(1_200_000)
      .mockReturnValue(1_221_000);

    try {
      const result = await drainFailedOrderCancellationSideEffects({
        deadlineMs: 1_270_000,
        limit: 1,
        sendCancellationEmail: vi.fn(),
        supabase: { from } as never,
      });

      expect(failedQuery.neq).not.toHaveBeenCalled();
      expect(mocks.run).not.toHaveBeenCalled();
      expect(from).toHaveBeenCalledTimes(5);
      expect(result).toEqual({ drained: [], failed: [], skipped: [] });
    } finally {
      now.mockRestore();
    }
  });
});
