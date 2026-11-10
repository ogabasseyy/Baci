import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ alert: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock('@/lib/orders/alert-merchant-cancellation-refund-review', () => ({
  alertMerchantOfRefundReview: mocks.alert,
  MIN_ALERT_BUDGET_MS: 8_000,
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
  alerted = [] as string[],
  reviewError = null as Error | null,
  reviews = [
    { candidates: [], id: 'r1', merchant_id: 'm1', order_id: 'o1' },
    { candidates: [], id: 'r2', merchant_id: 'm1', order_id: 'o2' },
  ],
} = {}) {
  const tables: Record<string, unknown> = {
    merchants: chain({ data: [{ email: 'a@b.c', id: 'm1' }], error: null }),
    order_cancellation_refund_alerts: chain({
      data: alerted.map((review_id) => ({ review_id })),
      error: null,
    }),
    orders: chain({
      data: [
        { currency: 'NGN', id: 'o1', merchant_id: 'm1', order_number: '1' },
        { currency: 'NGN', id: 'o2', merchant_id: 'other', order_number: '2' },
      ],
      error: null,
    }),
    reconciliation_review: chain({ data: reviews, error: reviewError }),
  };
  return { from: vi.fn((t: string) => tables[t]) };
}

describe('alertPendingRefundReviews', () => {
  it('alerts unalerted open reviews, skipping tenant mismatches', async () => {
    mocks.alert.mockReset().mockResolvedValue('alerted');
    await alertPendingRefundReviews({ supabase: makeSupabase() as never });
    expect(mocks.alert).toHaveBeenCalledTimes(1);
    expect(mocks.alert.mock.calls[0][0]).toMatchObject({
      merchant: { email: 'a@b.c', id: 'm1' },
      order: { id: 'o1' },
      review: { id: 'r1' },
    });
  });

  it('retries a review whose earlier alert was released, not ones already alerted', async () => {
    const reviews = [
      { candidates: [], id: 'r1', merchant_id: 'm1', order_id: 'o1' },
    ];
    mocks.alert.mockReset().mockResolvedValue('alerted');
    await alertPendingRefundReviews({
      supabase: makeSupabase({ alerted: ['r1'], reviews }) as never,
    });
    expect(mocks.alert).not.toHaveBeenCalled();
    await alertPendingRefundReviews({
      supabase: makeSupabase({ reviews }) as never,
    });
    expect(mocks.alert).toHaveBeenCalledTimes(1);
  });

  it('does not let invalid reviews use up the per-pass alert slots', async () => {
    mocks.alert.mockReset().mockResolvedValue('alerted');
    const invalid = ['a', 'b', 'c'].map((id) => ({
      candidates: [],
      id,
      merchant_id: 'm1',
      order_id: 'o2',
    }));
    await alertPendingRefundReviews({
      supabase: makeSupabase({
        reviews: [
          ...invalid,
          { candidates: [], id: 'valid', merchant_id: 'm1', order_id: 'o1' },
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
      deadlineMs: Date.now() + 1_000,
      supabase: supabase as never,
    });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('stops after a deferred alert', async () => {
    mocks.alert.mockReset().mockResolvedValue('deferred');
    const supabase = makeSupabase({
      reviews: [
        { candidates: [], id: 'r1', merchant_id: 'm1', order_id: 'o1' },
        { candidates: [], id: 'r3', merchant_id: 'm1', order_id: 'o1' },
      ],
    });
    await alertPendingRefundReviews({ supabase: supabase as never });
    expect(mocks.alert).toHaveBeenCalledTimes(1);
  });

  it('swallows a failed review lookup', async () => {
    mocks.alert.mockReset();
    await expect(
      alertPendingRefundReviews({
        supabase: makeSupabase({ reviewError: new Error('db') }) as never,
      })
    ).resolves.toBeUndefined();
    expect(mocks.alert).not.toHaveBeenCalled();
  });
});
