import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ alert: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock('@/lib/orders/alert-merchant-cancellation-refund-review', () => ({
  alertMerchantOfRefundReview: mocks.alert,
  MIN_ALERT_BUDGET_MS: 8_000,
  REFUND_ALERT_RETRY_CAP: 3,
}));

import { alertPendingRefundReviews } from './alert-pending-refund-reviews';

function chain(result: unknown) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'gte', 'order']) {
    q[m] = vi.fn(() => q);
  }
  q.limit = vi.fn().mockResolvedValue(result);
  q.in = vi.fn().mockResolvedValue(result);
  return q;
}

function makeSupabase({
  reviewError = null as Error | null,
  reviews = [
    {
      alert_attempts: null,
      candidates: [],
      id: 'r1',
      merchant_id: 'm1',
      metadata: {},
      order_id: 'o1',
    },
    {
      alert_attempts: null,
      candidates: [],
      id: 'r2',
      merchant_id: 'm1',
      metadata: {},
      order_id: 'o2',
    },
  ] as Record<string, unknown>[],
} = {}) {
  const tables: Record<string, unknown> = {
    merchants: chain({ data: [{ email: 'a@b.c', id: 'm1' }], error: null }),
    orders: chain({
      data: [
        { currency: 'NGN', id: 'o1', merchant_id: 'm1', order_number: '1' },
        { currency: 'NGN', id: 'o2', merchant_id: 'other', order_number: '2' },
      ],
      error: null,
    }),
  };
  return {
    from: vi.fn((t: string) => tables[t]),
    rpc: vi.fn().mockResolvedValue({ data: reviews, error: reviewError }),
  };
}

const senders = { sendEmail: vi.fn(), sendPush: vi.fn() };

describe('alertPendingRefundReviews', () => {
  it('alerts unalerted open reviews, skipping tenant mismatches', async () => {
    mocks.alert.mockReset().mockResolvedValue('delivered');
    await alertPendingRefundReviews({
      senders,
      supabase: makeSupabase() as never,
    });
    expect(mocks.alert).toHaveBeenCalledTimes(1);
    expect(mocks.alert.mock.calls[0][0]).toMatchObject({
      merchant: { email: 'a@b.c', id: 'm1' },
      order: { id: 'o1' },
      prior: null,
      review: { id: 'r1' },
    });
  });

  it('anti-joins alerted reviews in SQL before the scan limit', async () => {
    mocks.alert.mockReset().mockResolvedValue('delivered');
    const supabase = makeSupabase();
    await alertPendingRefundReviews({ senders, supabase: supabase as never });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'list_cancellation_refund_reviews_needing_alert_v1',
      expect.objectContaining({ p_limit: 50, p_max_attempts: 3 })
    );
    // The ledger is never read client-side after the limit.
    expect(supabase.from).not.toHaveBeenCalledWith(
      'order_cancellation_refund_alerts'
    );
  });

  it('re-drives an unconfirmed claim with its prior attempt count', async () => {
    mocks.alert.mockReset().mockResolvedValue('delivered');
    await alertPendingRefundReviews({
      senders,
      supabase: makeSupabase({
        reviews: [
          {
            alert_attempts: 2,
            candidates: [],
            id: 'r1',
            merchant_id: 'm1',
            metadata: { ambiguous_initiation: true },
            order_id: 'o1',
          },
        ],
      }) as never,
    });
    expect(mocks.alert.mock.calls[0][0]).toMatchObject({
      prior: { attempts: 2 },
      review: { id: 'r1', metadata: { ambiguous_initiation: true } },
    });
  });

  it('does not let invalid reviews use up the per-pass alert slots', async () => {
    mocks.alert.mockReset().mockResolvedValue('delivered');
    const invalid = ['a', 'b', 'c'].map((id) => ({
      alert_attempts: null,
      candidates: [],
      id,
      merchant_id: 'm1',
      metadata: {},
      order_id: 'o2',
    }));
    await alertPendingRefundReviews({
      senders,
      supabase: makeSupabase({
        reviews: [
          ...invalid,
          {
            alert_attempts: null,
            candidates: [],
            id: 'valid',
            merchant_id: 'm1',
            metadata: {},
            order_id: 'o1',
          },
        ],
      }) as never,
    });
    expect(mocks.alert).toHaveBeenCalledTimes(1);
    expect(mocks.alert.mock.calls[0][0]).toMatchObject({
      review: { id: 'valid' },
    });
  });

  it('does nothing when the phase budget is exhausted', async () => {
    mocks.alert.mockReset();
    const supabase = makeSupabase();
    await alertPendingRefundReviews({
      senders,
      deadlineMs: Date.now() + 1_000,
      supabase: supabase as never,
    });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('stops after a deferred alert', async () => {
    mocks.alert.mockReset().mockResolvedValue('deferred');
    const supabase = makeSupabase({
      reviews: [
        {
          alert_attempts: null,
          candidates: [],
          id: 'r1',
          merchant_id: 'm1',
          metadata: {},
          order_id: 'o1',
        },
        {
          alert_attempts: null,
          candidates: [],
          id: 'r3',
          merchant_id: 'm1',
          metadata: {},
          order_id: 'o1',
        },
      ],
    });
    await alertPendingRefundReviews({ senders, supabase: supabase as never });
    expect(mocks.alert).toHaveBeenCalledTimes(1);
  });

  it('returns counts for the pass', async () => {
    mocks.alert
      .mockReset()
      .mockResolvedValueOnce('delivered')
      .mockResolvedValueOnce('failed')
      .mockResolvedValueOnce('uncertain');
    const supabase = makeSupabase({
      reviews: [
        {
          alert_attempts: null,
          candidates: [],
          id: 'r1',
          merchant_id: 'm1',
          metadata: {},
          order_id: 'o1',
        },
        ...['r3', 'r4'].map((id) => ({
          alert_attempts: null,
          candidates: [],
          id,
          merchant_id: 'm1',
          metadata: {},
          order_id: 'o1',
        })),
      ],
    });
    await expect(
      alertPendingRefundReviews({ senders, supabase: supabase as never })
    ).resolves.toEqual({
      alerted: 1,
      attempted: 3,
      deferred: 0,
      failed: 1,
      uncertain: 1,
    });
  });

  it('does not count a duplicate claim as a failure', async () => {
    mocks.alert.mockReset().mockResolvedValue('duplicate');
    await expect(
      alertPendingRefundReviews({ senders, supabase: makeSupabase() as never })
    ).resolves.toMatchObject({ alerted: 0, failed: 0, uncertain: 0 });
  });

  it('counts a deferral and stops', async () => {
    mocks.alert.mockReset().mockResolvedValue('deferred');
    await expect(
      alertPendingRefundReviews({ senders, supabase: makeSupabase() as never })
    ).resolves.toMatchObject({ attempted: 1, deferred: 1 });
  });

  it('includes the underlying lookup error in the log', async () => {
    const error = new Error('rpc down');
    const { logger } = await import('@/lib/logger');
    const result = await alertPendingRefundReviews({
      senders,
      supabase: makeSupabase({ reviewError: error }) as never,
    });
    expect(result.failed).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        error,
        message: expect.stringContaining('lookup failed'),
      })
    );
  });

  it('swallows a failed review lookup', async () => {
    mocks.alert.mockReset();
    await expect(
      alertPendingRefundReviews({
        senders,
        supabase: makeSupabase({ reviewError: new Error('db') }) as never,
      })
    ).resolves.toMatchObject({ failed: 1 });
    expect(mocks.alert).not.toHaveBeenCalled();
  });
});
