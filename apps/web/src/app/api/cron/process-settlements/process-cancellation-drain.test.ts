import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  drainFailedOrderCancellationSideEffects: vi.fn(),
  drainPaystackRefundNotifications: vi.fn(),
  reconcileCompletedPaystackCancellationRefunds: vi.fn(),
  reconcilePendingPaystackCancellationRefunds: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
  sendEmail: vi.fn(),
  notifyMerchant: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: mocks.loggerError,
    warn: mocks.loggerWarn,
  },
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

import { processCancellationDrain } from './process-cancellation-drain';

describe('processCancellationDrain', () => {
  const supabase = { from: vi.fn(), rpc: vi.fn() } as never;

  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      mock.mockReset();
    }

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

  it('runs every cancellation worker and reports their results', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    let response: Awaited<ReturnType<typeof processCancellationDrain>>;
    try {
      response = await processCancellationDrain(
        supabase,
        mocks.sendEmail,
        mocks.notifyMerchant
      );
    } finally {
      now.mockRestore();
    }

    expect(response.status).toBe(200);
    expect(mocks.drainFailedOrderCancellationSideEffects).toHaveBeenCalledWith(
      expect.objectContaining({
        deadlineMs: expect.any(Number),
        limit: 9,
        sendCancellationEmail: mocks.sendEmail,
      })
    );
    expect(
      mocks.reconcilePendingPaystackCancellationRefunds
    ).toHaveBeenCalledWith(supabase);
    expect(
      mocks.reconcileCompletedPaystackCancellationRefunds
    ).toHaveBeenCalledWith(supabase);
    expect(mocks.drainPaystackRefundNotifications).toHaveBeenCalledWith(
      supabase,
      mocks.sendEmail,
      9,
      mocks.notifyMerchant
    );
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ success: true })
    );
  });

  it('skips the notification drain when the workers exhausted the cron budget', async () => {
    const now = vi.spyOn(Date, 'now');
    now
      .mockReturnValueOnce(1_000_000)
      .mockReturnValueOnce(1_290_000)
      .mockReturnValue(1_290_000);
    try {
      const response = await processCancellationDrain(
        supabase,
        mocks.sendEmail,
        mocks.notifyMerchant
      );

      expect(response.status).toBe(200);
      expect(mocks.drainPaystackRefundNotifications).toHaveBeenCalledWith(
        supabase,
        mocks.sendEmail,
        0,
        mocks.notifyMerchant
      );
      expect(mocks.loggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('cron budget exhausted'),
        })
      );
    } finally {
      now.mockRestore();
    }
  });

  it('skips the side-effect drain when the workers exhausted the cron budget', async () => {
    const now = vi.spyOn(Date, 'now');
    now
      .mockReturnValueOnce(1_000_000)
      .mockReturnValueOnce(1_290_000)
      .mockReturnValue(1_290_000);
    try {
      const response = await processCancellationDrain(
        supabase,
        mocks.sendEmail,
        mocks.notifyMerchant
      );

      expect(response.status).toBe(200);
      expect(
        mocks.drainFailedOrderCancellationSideEffects
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          deadlineMs: 1_270_000,
          limit: 0,
          sendCancellationEmail: mocks.sendEmail,
        })
      );
      expect(mocks.loggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('side-effect drain'),
        })
      );
    } finally {
      now.mockRestore();
    }
  });

  it('retries side effects only after refund reconciliation settles', async () => {
    let resolveRefunds!: (value: unknown) => void;
    const refundsGate = new Promise((resolve) => {
      resolveRefunds = resolve as (value: unknown) => void;
    });
    mocks.reconcilePendingPaystackCancellationRefunds.mockReturnValueOnce(
      refundsGate.then(() => ({ checked: 0, failed: 0 }))
    );

    const drainPromise = processCancellationDrain(
      supabase,
      mocks.sendEmail,
      mocks.notifyMerchant
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(
      mocks.drainFailedOrderCancellationSideEffects
    ).not.toHaveBeenCalled();
    resolveRefunds(undefined);
    await drainPromise;
    expect(mocks.drainFailedOrderCancellationSideEffects).toHaveBeenCalled();
  });

  it('still reconciles refunds when cancellation side effect draining fails', async () => {
    mocks.drainFailedOrderCancellationSideEffects.mockRejectedValueOnce(
      new Error('temporary failure')
    );
    const response = await processCancellationDrain(
      supabase,
      mocks.sendEmail,
      mocks.notifyMerchant
    );
    expect(response.status).toBe(503);
    expect(
      mocks.reconcilePendingPaystackCancellationRefunds
    ).toHaveBeenCalled();
    expect(mocks.drainPaystackRefundNotifications).toHaveBeenCalled();
  });

  it.each([
    ['pending refunds', 'reconcilePendingPaystackCancellationRefunds'],
    ['legacy refunds', 'reconcileCompletedPaystackCancellationRefunds'],
    ['refund notifications', 'drainPaystackRefundNotifications'],
  ] as const)('returns 503 when fulfilled %s report failures', async (_label, worker) => {
    mocks[worker].mockResolvedValueOnce({
      checked: 1,
      claimed: 1,
      failed: 1,
      sent: 0,
    });
    const response = await processCancellationDrain(
      supabase,
      mocks.sendEmail,
      mocks.notifyMerchant
    );
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({
      error: 'Cancellation and refund background work incomplete',
    });
  });

  it('returns 503 when the cancellation drain reports failed rows', async () => {
    mocks.drainFailedOrderCancellationSideEffects.mockResolvedValueOnce({
      drained: [],
      failed: [{ orderId: 'order-1', reason: 'failed', step: 'refund' }],
      skipped: [],
    });
    const response = await processCancellationDrain(
      supabase,
      mocks.sendEmail,
      mocks.notifyMerchant
    );

    expect(response.status).toBe(503);
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ cancellationFailed: true })
    );
  });
});
