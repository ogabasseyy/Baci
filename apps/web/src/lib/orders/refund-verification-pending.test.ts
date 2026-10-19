import { describe, expect, it, vi } from 'vitest';

const loggerWarn = vi.hoisted(() => vi.fn());
vi.mock('@/lib/logger', () => ({ logger: { warn: loggerWarn } }));

import {
  CANCELLATION_DRAIN_FETCH_LIMIT,
  CANCELLATION_DRAIN_MAX_ATTEMPTS,
} from './drain-failed-order-cancellation-side-effects';
import { isRefundVerificationPending } from './refund-verification-pending';

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

  it('warns with a reason on every failed-closed probe so outages surface', async () => {
    loggerWarn.mockClear();
    const from = vi
      .fn()
      .mockReturnValue(chain({ data: null, error: new Error('boom') }));
    const supabase = { from } as never;

    await expect(isRefundVerificationPending(supabase)).resolves.toBe(true);
    await expect(isRefundVerificationPending(supabase)).resolves.toBe(true);
    // Genuine pending stays silent; every error-driven cap warns, so
    // a persistent probe outage is distinguishable in ops telemetry.
    expect(loggerWarn).toHaveBeenCalledTimes(2);
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'side_effects_failed_read' })
    );
  });
});
