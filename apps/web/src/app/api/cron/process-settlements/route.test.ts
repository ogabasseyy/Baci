import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  drainFailedOrderCancellationSideEffects: vi.fn(),
  drainPaystackRefundNotifications: vi.fn(),
  reconcileCompletedPaystackCancellationRefunds: vi.fn(),
  reconcilePendingPaystackCancellationRefunds: vi.fn(),
  eq: vi.fn(),
  from: vi.fn(),
  in: vi.fn(),
  limit: vi.fn(),
  lt: vi.fn(),
  loggerError: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  or: vi.fn(),
  order: vi.fn(),
  rpc: vi.fn(),
  select: vi.fn(),
  sendEmail: vi.fn(),
  notifyMerchant: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: mocks.loggerError,
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
  },
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: mocks.from,
    rpc: mocks.rpc,
  }),
}));

vi.mock('@/lib/zeptomail', () => ({
  sendEmail: mocks.sendEmail,
}));
vi.mock('@/lib/expo-push', () => ({ notifyMerchant: mocks.notifyMerchant }));
vi.mock('@/lib/orders/drain-failed-order-cancellation-side-effects', () => ({
  drainFailedOrderCancellationSideEffects:
    mocks.drainFailedOrderCancellationSideEffects,
}));
vi.mock('@/lib/payments/drain-paystack-refund-notifications', () => ({
  drainPaystackRefundNotifications: mocks.drainPaystackRefundNotifications,
}));
vi.mock(
  '@/lib/payments/reconcile-pending-paystack-cancellation-refunds',
  () => ({
    reconcilePendingPaystackCancellationRefunds:
      mocks.reconcilePendingPaystackCancellationRefunds,
  })
);
vi.mock(
  '@/lib/payments/reconcile-completed-paystack-cancellation-refunds',
  () => ({
    reconcileCompletedPaystackCancellationRefunds:
      mocks.reconcileCompletedPaystackCancellationRefunds,
  })
);

import { maxDuration, POST } from './route';
import {
  makeCronRequest,
  stubDefaultSettlementRun,
} from './route.test-support';

describe('POST /api/cron/process-settlements', () => {
  it('declares the five-minute function duration', () => {
    expect(maxDuration).toBe(300);
  });

  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      mock.mockReset();
    }
    stubDefaultSettlementRun(mocks);
  });

  it('rejects requests without the configured cron secret before processing settlements', async () => {
    const response = await POST(makeCronRequest('wrong-secret'));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: 'Unauthorized' });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(
      mocks.drainFailedOrderCancellationSideEffects
    ).not.toHaveBeenCalled();
    expect(
      mocks.reconcilePendingPaystackCancellationRefunds
    ).not.toHaveBeenCalled();
    expect(
      mocks.reconcileCompletedPaystackCancellationRefunds
    ).not.toHaveBeenCalled();
    expect(mocks.drainPaystackRefundNotifications).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('returns a 500 and skips notifications when settlement processing fails', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'rpc timeout' },
    });

    const response = await POST(makeCronRequest());
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: 'Failed to process settlements' });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to process due settlements',
      })
    );
  });

  it('uses merchant email without unsupported users embed for settlement notifications', async () => {
    const response = await POST(makeCronRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.drainFailedOrderCancellationSideEffects).toHaveBeenCalledWith(
      expect.objectContaining({ sendCancellationEmail: mocks.sendEmail })
    );
    expect(payload.notifications).toEqual({ failed: 0, sent: 1 });

    const selectColumns = String(mocks.select.mock.calls[0]?.[0] ?? '');
    expect(selectColumns).toContain('email');
    expect(selectColumns).not.toContain('users');
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'merchant@example.com',
        toName: 'Merchant Shop',
      })
    );
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        notification_sent_at: expect.any(String),
        settlement_notified: true,
      })
    );
    expect(mocks.in).toHaveBeenCalledWith('id', ['settlement-1']);
  });

  it('skips announcing a settlement reversed after the batch read', async () => {
    // A concurrent refund cancelled the snapshotted row before the
    // per-merchant send: announcing it would tell the merchant
    // reversed funds settled.
    mocks.in.mockResolvedValueOnce({
      data: [
        {
          id: 'settlement-1',
          settlement_notified: false,
          status: 'cancelled',
        },
      ],
      error: null,
    });

    const response = await POST(makeCronRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.notifications).toEqual({ failed: 0, sent: 0 });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('guards the notified mark against a reversal racing the send', async () => {
    const response = await POST(makeCronRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.notifications).toEqual({ failed: 0, sent: 1 });
    expect(mocks.eq).toHaveBeenCalledWith('status', 'settled');
    expect(mocks.eq).toHaveBeenCalledWith('settlement_notified', false);
  });

  it('excludes capped and backoff-deferred rows from the bounded queue', async () => {
    const response = await POST(makeCronRequest());

    expect(response.status).toBe(200);
    // Permanently failing rows must not pin the oldest-first batch:
    // the fetch skips rows past the attempt cap and rows whose retry
    // is not due yet.
    expect(mocks.lt).toHaveBeenCalledWith('notification_attempts', 5);
    expect(mocks.or).toHaveBeenCalledWith(
      expect.stringContaining('notification_next_retry_at.is.null')
    );
    expect(mocks.or).toHaveBeenCalledWith(
      expect.stringContaining('notification_next_retry_at.lte.')
    );
    // Fractional seconds inject a dot the OR parser reads as a
    // condition separator: the retry-due stamp stays millis-free.
    const orFilters = mocks.or.mock.calls.map(([filter]) => String(filter));
    expect(orFilters.join(' ')).not.toMatch(/\d{2}:\d{2}:\d{2}\.\d+Z/);
  });

  it('continues without sending emails when pending notification lookup fails', async () => {
    mocks.limit.mockResolvedValue({
      data: null,
      error: { message: 'relationship not found' },
    });

    const response = await POST(makeCronRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.notifications).toEqual({ failed: 0, sent: 0 });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to fetch pending notifications',
      })
    );
  });

  it('defers settlement notifications when the merchant email is missing', async () => {
    mocks.limit.mockResolvedValue({
      data: [
        {
          actual_settlement_date: '2026-05-31',
          description: 'Order BAC-124',
          gateway: 'paystack',
          id: 'settlement-2',
          merchant_id: 'merchant-2',
          merchants: {
            business_name: 'Merchant Shop',
            email: null,
            id: 'merchant-2',
          },
          net_amount: 3000,
          source_type: 'order',
        },
      ],
      error: null,
    });
    // No per-merchant send runs, so the batch fetch is followed
    // directly by the retry-accounting update.
    mocks.from.mockReset();
    mocks.from
      .mockReturnValueOnce({ select: mocks.select })
      .mockReturnValueOnce({ update: mocks.update });

    const response = await POST(makeCronRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.notifications).toEqual({ failed: 1, sent: 0 });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith({
      notification_attempts: 1,
      notification_next_retry_at: expect.any(String),
    });
  });

  it('bounds the cancellation drain by the remaining route budget', async () => {
    const now = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(1_000_000)
      .mockReturnValueOnce(1_120_000);
    try {
      const response = await POST(makeCronRequest());

      expect(response.status).toBe(200);
      expect(
        mocks.drainFailedOrderCancellationSideEffects
      ).toHaveBeenCalledWith(
        expect.objectContaining({ deadlineMs: 1_270_000, limit: 5 })
      );
    } finally {
      now.mockRestore();
    }
  });

  it('skips the cancellation drain once the abort margin is gone', async () => {
    const now = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(1_000_000)
      .mockReturnValueOnce(1_300_000);
    try {
      const response = await POST(makeCronRequest());
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(
        mocks.drainFailedOrderCancellationSideEffects
      ).not.toHaveBeenCalled();
      expect(payload.cancellationSideEffectDrain).toEqual({
        drained: [],
        failed: [],
        skipped: [],
      });
      // Deferred work must not look like an idle system: pollers see
      // the skip flag and operators get the warn log.
      expect(payload.skippedDueToBudget).toBe(true);
      expect(mocks.loggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            'Skipping cancellation side-effect drain: cron budget exhausted',
        })
      );
    } finally {
      now.mockRestore();
    }
  });

  it('reports no budget skip when the cancellation drain runs', async () => {
    const response = await POST(makeCronRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.drainFailedOrderCancellationSideEffects).toHaveBeenCalled();
    expect(payload.skippedDueToBudget).toBe(false);
    expect(mocks.loggerWarn).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Skipping cancellation side-effect drain: cron budget exhausted',
      })
    );
  });
});
