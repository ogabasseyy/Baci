import { describe, expect, it, vi } from 'vitest';
import {
  CANCELLATION_DRAIN_FETCH_LIMIT,
  CANCELLATION_DRAIN_MAX_ATTEMPTS,
} from './drain-failed-order-cancellation-side-effects';
import { isRefundVerificationPending } from './refund-verification-pending';

function chain(result: { data: unknown; error: Error | null }) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ['select', 'eq', 'lt', 'in', 'gt', 'ilike', 'order']) {
    query[method] = vi.fn().mockReturnValue(query);
  }
  query.limit = vi.fn().mockResolvedValue(result);
  return query;
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

  it('returns true when a failed refund step has a funded Paystack leg', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(
        chain({ data: [{ order_id: 'order-1' }], error: null })
      )
      .mockReturnValueOnce(chain({ data: [], error: null }))
      .mockReturnValueOnce(
        chain({ data: [{ gateway: 'paystack' }], error: null })
      );
    const supabase = { from } as never;

    await expect(isRefundVerificationPending(supabase)).resolves.toBe(true);
  });

  it('returns true when only a deferred refund step has a funded Paystack leg', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(chain({ data: [], error: null }))
      .mockReturnValueOnce(
        chain({ data: [{ order_id: 'order-2' }], error: null })
      )
      .mockReturnValueOnce(
        chain({ data: [{ gateway: 'paystack' }], error: null })
      );
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

  it('returns false when no leg normalizes to Paystack', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(
        chain({ data: [{ order_id: 'order-1' }], error: null })
      )
      .mockReturnValueOnce(chain({ data: [], error: null }))
      .mockReturnValueOnce(
        chain({ data: [{ gateway: 'flutterwave' }], error: null })
      );
    const supabase = { from } as never;

    await expect(isRefundVerificationPending(supabase)).resolves.toBe(false);
  });

  it('fails closed on a step-read error so a probe outage never shortens reconciliation', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(chain({ data: null, error: new Error('boom') }));
    const supabase = { from } as never;

    await expect(isRefundVerificationPending(supabase)).resolves.toBe(false);
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('fails closed on a leg-read error', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(
        chain({ data: [{ order_id: 'order-1' }], error: null })
      )
      .mockReturnValueOnce(chain({ data: [], error: null }))
      .mockReturnValueOnce(chain({ data: null, error: new Error('boom') }));
    const supabase = { from } as never;

    await expect(isRefundVerificationPending(supabase)).resolves.toBe(false);
  });
});
