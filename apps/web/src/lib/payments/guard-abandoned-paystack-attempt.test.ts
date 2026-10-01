import { describe, expect, it, vi } from 'vitest';
import { guardAbandonedPaystackAttempt } from './guard-abandoned-paystack-attempt';

function chain(result: { data: unknown; error: unknown }) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ['select', 'eq', 'in', 'neq', 'limit', 'maybeSingle']) {
    query[method] =
      method === 'maybeSingle' || method === 'limit'
        ? vi.fn(async () => result)
        : vi.fn(() => query);
  }
  return query;
}

describe('guardAbandonedPaystackAttempt', () => {
  const attempt = {
    id: 'attempt-1',
    merchant_id: 'merchant-1',
    order_id: 'order-1',
  };

  function harness(orderResult: unknown, completedResult: unknown) {
    const hold = vi.fn().mockResolvedValue(undefined);
    const summary = { failed: false };
    const orderQuery = chain({ data: orderResult, error: null });
    const completedQuery = chain({ data: completedResult, error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(orderQuery)
      .mockReturnValueOnce(completedQuery);
    return { completedQuery, from, hold, orderQuery, summary };
  }

  it('proceeds when a different funded payment supersedes the attempt', async () => {
    const h = harness({ id: 'order-1' }, [{ id: 'paid-attempt' }]);

    await expect(
      guardAbandonedPaystackAttempt({
        attempt,
        hold: h.hold,
        isCompletedRetry: false,
        summary: h.summary,
        supabase: { from: h.from } as never,
      })
    ).resolves.toBe('proceed');
    expect(h.orderQuery.in).toHaveBeenCalledWith('payment_status', [
      'paid',
      'partially_paid',
    ]);
    expect(h.completedQuery.neq).toHaveBeenCalledWith('id', 'attempt-1');
    expect(h.hold).not.toHaveBeenCalled();
    expect(h.summary.failed).toBe(false);
  });

  it('holds when the order is not paid or unavailable', async () => {
    const h = harness(null, [{ id: 'paid-attempt' }]);

    await expect(
      guardAbandonedPaystackAttempt({
        attempt,
        hold: h.hold,
        isCompletedRetry: false,
        summary: h.summary,
        supabase: { from: h.from } as never,
      })
    ).resolves.toBe('held');
    expect(h.hold).toHaveBeenCalledWith('order_not_paid_or_unavailable');
    expect(h.summary.failed).toBe(false);
  });

  it('fails the sweep when the order lookup errors', async () => {
    const hold = vi.fn().mockResolvedValue(undefined);
    const summary = { failed: false };
    const from = vi
      .fn()
      .mockReturnValueOnce(
        chain({ data: null, error: { message: 'db down' } })
      );

    await expect(
      guardAbandonedPaystackAttempt({
        attempt,
        hold,
        isCompletedRetry: false,
        summary,
        supabase: { from } as never,
      })
    ).resolves.toBe('held');
    expect(hold).toHaveBeenCalledWith('order_not_paid_or_unavailable');
    expect(summary.failed).toBe(true);
  });

  it('holds when no other funded payment exists', async () => {
    const h = harness({ id: 'order-1' }, []);

    await expect(
      guardAbandonedPaystackAttempt({
        attempt,
        hold: h.hold,
        isCompletedRetry: false,
        summary: h.summary,
        supabase: { from: h.from } as never,
      })
    ).resolves.toBe('held');
    expect(h.hold).toHaveBeenCalledWith('no_completed_payment_or_unavailable');
    expect(h.summary.failed).toBe(false);
  });

  it('skips the paid filter for a completed retry', async () => {
    const h = harness({ id: 'order-1' }, [{ id: 'paid-attempt' }]);

    await expect(
      guardAbandonedPaystackAttempt({
        attempt,
        hold: h.hold,
        isCompletedRetry: true,
        summary: h.summary,
        supabase: { from: h.from } as never,
      })
    ).resolves.toBe('proceed');
    expect(h.orderQuery.in).not.toHaveBeenCalled();
    expect(h.hold).not.toHaveBeenCalled();
  });
});
