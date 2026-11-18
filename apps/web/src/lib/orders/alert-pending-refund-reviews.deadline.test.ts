import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ alert: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock('@/lib/orders/alert-merchant-cancellation-refund-review', () => ({
  alertMerchantOfRefundReview: mocks.alert,
}));

import { alertPendingRefundReviews } from './alert-pending-refund-reviews';

const senders = { sendEmail: vi.fn(), sendPush: vi.fn() };
const review = {
  alert_attempts: null,
  candidates: [],
  id: 'r1',
  merchant_id: 'm1',
  metadata: {},
  order_id: 'o1',
};

afterEach(() => vi.useRealTimers());

describe('alertPendingRefundReviews lookup deadlines', () => {
  it('defers the pass, aborts the read and claims nothing when the review lookup outlives the deadline', async () => {
    vi.useFakeTimers();
    mocks.alert.mockReset();
    let aborted = false;
    const supabase = {
      from: vi.fn(),
      rpc: vi.fn(() => ({
        abortSignal: (signal: AbortSignal) => {
          signal.addEventListener('abort', () => {
            aborted = true;
          });
          return new Promise(() => {});
        },
      })),
    };
    const pending = alertPendingRefundReviews({
      deadlineMs: Date.now() + 9_000,
      senders,
      supabase: supabase as never,
    });
    await vi.advanceTimersByTimeAsync(9_000);
    await expect(pending).resolves.toMatchObject({ attempted: 0, deferred: 1 });
    expect(aborted).toBe(true);
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it('defers the pass when the context lookups outlive the deadline', async () => {
    vi.useFakeTimers();
    mocks.alert.mockReset();
    const hang = () => ({
      select: () => ({
        in: () => ({ abortSignal: () => new Promise(() => {}) }),
      }),
    });
    const supabase = {
      from: vi.fn(hang),
      rpc: vi.fn(() => ({
        abortSignal: () => Promise.resolve({ data: [review], error: null }),
      })),
    };
    const pending = alertPendingRefundReviews({
      deadlineMs: Date.now() + 9_000,
      senders,
      supabase: supabase as never,
    });
    await vi.advanceTimersByTimeAsync(9_000);
    await expect(pending).resolves.toMatchObject({ attempted: 0, deferred: 1 });
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it('stops after the claim round-trip cap even when every row is a duplicate', async () => {
    mocks.alert.mockReset().mockResolvedValue('duplicate');
    const reviews = Array.from({ length: 30 }, (_, i) => ({
      ...review,
      id: `r${i}`,
    }));
    const lookup = (rows: unknown[]) => ({
      select: () => ({
        in: () => ({
          abortSignal: () => Promise.resolve({ data: rows, error: null }),
        }),
      }),
    });
    const supabase = {
      from: vi.fn((table: string) =>
        table === 'orders'
          ? lookup([
              {
                currency: 'NGN',
                id: 'o1',
                merchant_id: 'm1',
                order_number: '1',
              },
            ])
          : lookup([{ email: 'a@b.c', id: 'm1' }])
      ),
      rpc: vi.fn(() => ({
        abortSignal: () => Promise.resolve({ data: reviews, error: null }),
      })),
    };
    const result = await alertPendingRefundReviews({
      senders,
      supabase: supabase as never,
    });
    expect(mocks.alert).toHaveBeenCalledTimes(10);
    expect(result).toMatchObject({ attempted: 0, duplicate: 10 });
  });

  it('reports a budget-driven early exit as deferred, not as an empty pass', async () => {
    const supabase = { from: vi.fn(), rpc: vi.fn() };
    const result = await alertPendingRefundReviews({
      deadlineMs: Date.now() + 1_000,
      senders,
      supabase: supabase as never,
    });
    expect(result).toMatchObject({ attempted: 0, deferred: 1 });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
