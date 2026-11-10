import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ alert: vi.fn() }));

vi.mock('@/lib/orders/alert-pending-refund-reviews', () => ({
  alertPendingRefundReviews: mocks.alert,
}));

import { drainFailedOrderCancellationSideEffects } from './drain-failed-order-cancellation-side-effects';

function query(data: unknown) {
  return {
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data, error: null }),
    lt: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
  };
}

describe('drain pending refund-review alerts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.alert.mockResolvedValue(undefined);
  });

  it('runs the alert pass after an empty drain, bounded by the refund cutoff', async () => {
    const from = vi.fn(() => query([]));
    const refundDeadlineMs = Date.now() + 100_000;
    await drainFailedOrderCancellationSideEffects({
      refundDeadlineMs,
      sendCancellationEmail: vi.fn(),
      refundAlertSenders: { sendEmail: vi.fn(), sendPush: vi.fn() },
      supabase: { from } as never,
    });
    expect(mocks.alert).toHaveBeenCalledTimes(1);
    expect(mocks.alert.mock.calls[0][0]).toMatchObject({
      deadlineMs: refundDeadlineMs,
    });
  });

  it('skips the alert pass when no alert senders are wired', async () => {
    await drainFailedOrderCancellationSideEffects({
      sendCancellationEmail: vi.fn(),
      supabase: { from: vi.fn(() => query([])) } as never,
    });
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it('falls back to the shared deadline when no refund cutoff is given', async () => {
    const deadlineMs = Date.now() + 50_000;
    await drainFailedOrderCancellationSideEffects({
      deadlineMs,
      sendCancellationEmail: vi.fn(),
      refundAlertSenders: { sendEmail: vi.fn(), sendPush: vi.fn() },
      supabase: { from: vi.fn(() => query([])) } as never,
    });
    expect(mocks.alert.mock.calls[0][0]).toMatchObject({ deadlineMs });
  });

  it('still runs the alert pass when a side-effect lookup throws, rethrowing the original error', async () => {
    const failing = {
      ...query([]),
      limit: vi.fn().mockResolvedValue({ data: null, error: { message: 'x' } }),
    };
    await expect(
      drainFailedOrderCancellationSideEffects({
        sendCancellationEmail: vi.fn(),
        refundAlertSenders: { sendEmail: vi.fn(), sendPush: vi.fn() },
        supabase: { from: vi.fn(() => failing) } as never,
      })
    ).rejects.toThrow('cancellation_side_effect_lookup_failed');
    expect(mocks.alert).toHaveBeenCalledTimes(1);
  });
});
