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
  loggerError: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  order: vi.fn(),
  rpc: vi.fn(),
  select: vi.fn(),
  sendEmail: vi.fn(),
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
vi.mock('@/lib/orders/drain-failed-order-cancellation-side-effects', () => ({
  drainFailedOrderCancellationSideEffects:
    mocks.drainFailedOrderCancellationSideEffects,
}));
vi.mock('@/lib/payments/drain-paystack-refund-notifications', () => ({
  drainPaystackRefundNotifications: mocks.drainPaystackRefundNotifications,
}));
vi.mock('@/lib/payments/reconcile-paystack-cancellation-refunds', () => ({
  reconcilePendingPaystackCancellationRefunds:
    mocks.reconcilePendingPaystackCancellationRefunds,
}));
vi.mock(
  '@/lib/payments/reconcile-completed-paystack-cancellation-refunds',
  () => ({
    reconcileCompletedPaystackCancellationRefunds:
      mocks.reconcileCompletedPaystackCancellationRefunds,
  })
);

import { POST } from './route';

function makeCronRequest(secret = 'test-secret') {
  return new Request('https://usebaci.com/api/cron/process-settlements', {
    headers: {
      Authorization: `Bearer ${secret}`,
    },
    method: 'POST',
  });
}

describe('POST /api/cron/process-settlements', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      mock.mockReset();
    }
    vi.stubEnv('CRON_SECRET', 'test-secret');

    mocks.rpc.mockResolvedValue({
      data: [{ details: [], processed_count: 0, total_amount: 0 }],
      error: null,
    });
    mocks.select.mockReturnValue({
      eq: mocks.eq,
      limit: mocks.limit,
      order: mocks.order,
    });
    mocks.eq.mockReturnValue({
      eq: mocks.eq,
      limit: mocks.limit,
      order: mocks.order,
    });
    mocks.order.mockReturnValue({
      limit: mocks.limit,
    });
    mocks.limit.mockResolvedValue({
      data: [
        {
          actual_settlement_date: '2026-05-31',
          description: 'Order BAC-123',
          gateway: 'paystack',
          id: 'settlement-1',
          merchant_id: 'merchant-1',
          merchants: {
            business_name: 'Merchant Shop',
            email: 'merchant@example.com',
            id: 'merchant-1',
          },
          net_amount: 2500,
          source_type: 'order',
        },
      ],
      error: null,
    });
    mocks.update.mockReturnValue({
      in: mocks.in,
    });
    mocks.in.mockResolvedValue({ data: null, error: null });
    mocks.from
      .mockReturnValueOnce({ select: mocks.select })
      .mockReturnValueOnce({ update: mocks.update });
    mocks.sendEmail.mockResolvedValue({ messageId: 'msg-1', success: true });
    mocks.drainFailedOrderCancellationSideEffects.mockResolvedValue({
      drained: [],
      failed: [],
      skipped: [],
    });
    mocks.reconcilePendingPaystackCancellationRefunds.mockResolvedValue({
      checked: 0,
      failed: 0,
    });
    mocks.reconcileCompletedPaystackCancellationRefunds.mockResolvedValue({
      checked: 0,
      failed: 0,
    });
    mocks.drainPaystackRefundNotifications.mockResolvedValue({
      claimed: 0,
      sent: 0,
      failed: 0,
    });
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

  it('skips settlement notifications when the merchant email is missing', async () => {
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

    const response = await POST(makeCronRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.notifications).toEqual({ failed: 0, sent: 0 });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
