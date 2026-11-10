import { afterEach, describe, expect, it, vi } from 'vitest';

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
});
