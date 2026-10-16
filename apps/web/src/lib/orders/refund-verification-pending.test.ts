import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CANCELLATION_DRAIN_FETCH_LIMIT,
  CANCELLATION_DRAIN_MAX_ATTEMPTS,
} from './drain-failed-order-cancellation-side-effects';
import {
  isRefundVerificationPending,
  isRefundVerificationPendingBefore,
} from './refund-verification-pending';

function chain(result: { data: unknown; error: Error | null }) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of [
    'select',
    'eq',
    'lt',
    'in',
    'gt',
    'ilike',
    'order',
    'abortSignal',
  ]) {
    query[method] = vi.fn().mockReturnValue(query);
  }
  query.limit = vi.fn().mockResolvedValue(result);
  return query;
}

const leg = {
  amount: 100,
  currency: 'NGN',
  gateway: 'paystack',
  id: 'leg-1',
  order_id: 'order-1',
};

function refund(overrides: Record<string, unknown> = {}) {
  return {
    amount: 100,
    currency: 'NGN',
    metadata: { payment_transaction_id: 'leg-1' },
    order_id: 'order-1',
    ...overrides,
  };
}

function stepsWith(orderIds: string[]) {
  return {
    data: orderIds.map((order_id) => ({ order_id })),
    error: null,
  };
}

describe('isRefundVerificationPending', () => {
  it('returns false without a leg read when no refund step needs work', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(chain({ data: [], error: null }))
      .mockReturnValueOnce(chain({ data: [], error: null }));
    const supabase = { from } as never;

    await expect(isRefundVerificationPending(supabase)).resolves.toBe(false);
    expect(from).toHaveBeenCalledTimes(2);
  });

  it('returns true when a failed refund step has an uncovered Paystack leg', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(chain(stepsWith(['order-1'])))
      .mockReturnValueOnce(chain({ data: [], error: null }))
      .mockReturnValueOnce(chain({ data: [leg], error: null }))
      .mockReturnValueOnce(chain({ data: [], error: null }));
    const supabase = { from } as never;

    await expect(isRefundVerificationPending(supabase)).resolves.toBe(true);
  });

  it('returns true when only a deferred refund step has an uncovered Paystack leg', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(chain({ data: [], error: null }))
      .mockReturnValueOnce(chain(stepsWith(['order-2'])))
      .mockReturnValueOnce(chain({ data: [leg], error: null }))
      .mockReturnValueOnce(chain({ data: [], error: null }));
    const supabase = { from } as never;

    await expect(isRefundVerificationPending(supabase)).resolves.toBe(true);
  });

  it('mirrors the drain per-status selection so a selected step is always inside the slice', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(chain({ data: [], error: null }))
      .mockReturnValueOnce(chain({ data: [], error: null }));
    const supabase = { from } as never;

    await isRefundVerificationPending(supabase);

    // An unfiltered limit could fill with manual orders and miss
    // the Paystack step the drain selects oldest-first: each slice
    // carries the drain's own status, attempts, order, and ceiling.
    const failedQuery = from.mock.results[0]?.value as Record<
      string,
      ReturnType<typeof vi.fn>
    >;
    expect(failedQuery.eq).toHaveBeenCalledWith('step', 'refund');
    expect(failedQuery.eq).toHaveBeenCalledWith('status', 'failed');
    expect(failedQuery.lt).toHaveBeenCalledWith(
      'attempts',
      CANCELLATION_DRAIN_MAX_ATTEMPTS
    );
    expect(failedQuery.order).toHaveBeenCalledWith('claimed_at', {
      ascending: true,
    });
    expect(failedQuery.limit).toHaveBeenCalledWith(
      CANCELLATION_DRAIN_FETCH_LIMIT
    );
    const deferredQuery = from.mock.results[1]?.value as Record<
      string,
      ReturnType<typeof vi.fn>
    >;
    expect(deferredQuery.eq).toHaveBeenCalledWith('step', 'refund');
    expect(deferredQuery.eq).toHaveBeenCalledWith('status', 'deferred');
    expect(deferredQuery.order).toHaveBeenCalledWith('claimed_at', {
      ascending: true,
    });
    expect(deferredQuery.limit).toHaveBeenCalledWith(
      CANCELLATION_DRAIN_FETCH_LIMIT
    );
  });

  it('scans only completed legs so in-flight rows never pin the cap', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(chain(stepsWith(['order-1'])))
      .mockReturnValueOnce(chain({ data: [], error: null }))
      // Server-side completed-only filter: an in-flight
      // (refund_pending) leg never reaches the probe.
      .mockReturnValueOnce(chain({ data: [], error: null }));
    const supabase = { from } as never;

    await expect(isRefundVerificationPending(supabase)).resolves.toBe(false);
    expect(from).toHaveBeenCalledTimes(3);
    const legsQuery = from.mock.results[2]?.value as Record<
      string,
      ReturnType<typeof vi.fn>
    >;
    expect(legsQuery.eq).toHaveBeenCalledWith('status', 'completed');
  });

  it('returns false when a linked completed refund covers the leg', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(chain(stepsWith(['order-1'])))
      .mockReturnValueOnce(chain({ data: [], error: null }))
      .mockReturnValueOnce(chain({ data: [leg], error: null }))
      .mockReturnValueOnce(chain({ data: [refund()], error: null }));
    const supabase = { from } as never;

    await expect(isRefundVerificationPending(supabase)).resolves.toBe(false);
  });

  it('returns true when linked refunds only partially cover the leg', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(chain(stepsWith(['order-1'])))
      .mockReturnValueOnce(chain({ data: [], error: null }))
      .mockReturnValueOnce(chain({ data: [leg], error: null }))
      .mockReturnValueOnce(
        chain({ data: [refund({ amount: 40 })], error: null })
      );
    const supabase = { from } as never;

    await expect(isRefundVerificationPending(supabase)).resolves.toBe(true);
  });

  it('returns true when the linked refund is an unverified Paystack attestation', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(chain(stepsWith(['order-1'])))
      .mockReturnValueOnce(chain({ data: [], error: null }))
      .mockReturnValueOnce(chain({ data: [leg], error: null }))
      .mockReturnValueOnce(
        chain({
          data: [
            refund({
              metadata: {
                method: 'paystack',
                payment_transaction_id: 'leg-1',
              },
            }),
          ],
          error: null,
        })
      );
    const supabase = { from } as never;

    await expect(isRefundVerificationPending(supabase)).resolves.toBe(true);
  });

  it('returns true when the linked refund currency mismatches the leg', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(chain(stepsWith(['order-1'])))
      .mockReturnValueOnce(chain({ data: [], error: null }))
      .mockReturnValueOnce(chain({ data: [leg], error: null }))
      .mockReturnValueOnce(
        chain({ data: [refund({ currency: 'USD' })], error: null })
      );
    const supabase = { from } as never;

    await expect(isRefundVerificationPending(supabase)).resolves.toBe(true);
  });

  it('returns false when no leg normalizes to Paystack', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(chain(stepsWith(['order-1'])))
      .mockReturnValueOnce(chain({ data: [], error: null }))
      .mockReturnValueOnce(
        chain({ data: [{ ...leg, gateway: 'flutterwave' }], error: null })
      );
    const supabase = { from } as never;

    await expect(isRefundVerificationPending(supabase)).resolves.toBe(false);
  });

  it('fails closed on a failed-step-read error so the preflight window survives', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(chain({ data: null, error: new Error('boom') }));
    const supabase = { from } as never;

    await expect(isRefundVerificationPending(supabase)).resolves.toBe(true);
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('fails closed on a deferred-step-read error', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(chain({ data: [], error: null }))
      .mockReturnValueOnce(chain({ data: null, error: new Error('boom') }));
    const supabase = { from } as never;

    await expect(isRefundVerificationPending(supabase)).resolves.toBe(true);
    expect(from).toHaveBeenCalledTimes(2);
  });

  it('fails closed on a leg-read error', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(chain(stepsWith(['order-1'])))
      .mockReturnValueOnce(chain({ data: [], error: null }))
      .mockReturnValueOnce(chain({ data: null, error: new Error('boom') }));
    const supabase = { from } as never;

    await expect(isRefundVerificationPending(supabase)).resolves.toBe(true);
  });

  it('fails closed on a refund-read error', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(chain(stepsWith(['order-1'])))
      .mockReturnValueOnce(chain({ data: [], error: null }))
      .mockReturnValueOnce(chain({ data: [leg], error: null }))
      .mockReturnValueOnce(chain({ data: null, error: new Error('boom') }));
    const supabase = { from } as never;

    await expect(isRefundVerificationPending(supabase)).resolves.toBe(true);
  });
});

describe('isRefundVerificationPendingBefore', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fails closed at the deadline when reads hang instead of erroring', async () => {
    vi.useFakeTimers();
    const hanging = () => new Promise<never>(() => {});
    const abortSignals: AbortSignal[] = [];
    const from = vi.fn().mockImplementation(() => {
      const query: Record<string, unknown> = {};
      for (const method of [
        'select',
        'eq',
        'lt',
        'in',
        'gt',
        'ilike',
        'order',
      ]) {
        (query as Record<string, unknown>)[method] = vi
          .fn()
          .mockReturnValue(query);
      }
      query.abortSignal = vi.fn().mockImplementation((signal: AbortSignal) => {
        abortSignals.push(signal);
        return query;
      });
      query.limit = vi.fn().mockImplementation(hanging);
      return query;
    });
    const supabase = { from } as never;

    const pending = isRefundVerificationPendingBefore(
      supabase,
      Date.now() + 500
    );
    await vi.advanceTimersByTimeAsync(500);
    // Fail closed (capped): the slow probe degrades the reconcile
    // phase instead of consuming the invocation.
    await expect(pending).resolves.toBe(true);
    // The losing probe is aborted, not merely abandoned: every
    // issued query carried the same signal, and the deadline
    // aborted it so postgrest cancels the orphaned reads.
    expect(abortSignals.length).toBeGreaterThan(0);
    for (const signal of abortSignals) {
      expect(signal.aborted).toBe(true);
    }
  });

  it('passes through a fast probe result before the deadline', async () => {
    vi.useFakeTimers();
    const from = vi
      .fn()
      .mockReturnValueOnce(chain({ data: [], error: null }))
      .mockReturnValueOnce(chain({ data: [], error: null }));
    const supabase = { from } as never;

    await expect(
      isRefundVerificationPendingBefore(supabase, Date.now() + 10_000)
    ).resolves.toBe(false);
  });

  it('fails closed when the probe throws before the deadline', async () => {
    const from = vi.fn().mockImplementation(() => {
      throw new Error('transport down');
    });
    const supabase = { from } as never;

    await expect(
      isRefundVerificationPendingBefore(supabase, Date.now() + 10_000)
    ).resolves.toBe(true);
  });

  it('fails closed immediately when the deadline already passed', async () => {
    const from = vi.fn();
    const supabase = { from } as never;

    await expect(
      isRefundVerificationPendingBefore(supabase, Date.now() - 1)
    ).resolves.toBe(true);
    expect(from).not.toHaveBeenCalled();
  });
});
