import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  drainFailedOrderCancellationSideEffects: vi.fn(),
  drainPaystackRefundNotifications: vi.fn(),
  isRefundVerificationPendingBefore: vi.fn(),
  reconcileCompletedPaystackCancellationRefunds: vi.fn(),
  reconcilePendingPaystackCancellationRefunds: vi.fn(),
  sweepPaystackRefundRecoveryWatches: vi.fn(),
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
vi.mock('@/lib/orders/refund-verification-pending', () => ({
  REFUND_VERIFICATION_PROBE_BUDGET_MS: 10_000,
  isRefundVerificationPendingBefore: mocks.isRefundVerificationPendingBefore,
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
vi.mock('@/lib/payments/sweep-paystack-refund-recovery-watches', () => ({
  sweepPaystackRefundRecoveryWatches: mocks.sweepPaystackRefundRecoveryWatches,
}));

import { processCancellationDrain } from './process-cancellation-drain';

describe('processCancellationDrain', () => {
  const supabase = { from: vi.fn(), rpc: vi.fn() } as never;

  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      mock.mockReset();
    }

    mocks.isRefundVerificationPendingBefore.mockResolvedValue(false);
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
    mocks.sweepPaystackRefundRecoveryWatches.mockResolvedValue({
      checked: 0,
      failed: 0,
      redriven: 0,
      retired: 0,
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
        // Side-effect work ends 180s before the shared deadline: the
        // 150s notification reserve plus the 30s handoff slack, so the
        // final step's tail lands before the notification threshold.
        deadlineMs: 1_090_000,
        // Emails admit against their own later cutoff: the 90s
        // side-effect deadline leaves no 48s sender budget after a
        // full reconcile phase.
        emailDeadlineMs: 1_120_000,
        // Refunds verify against the full phase end for the same
        // reason: the 90s row-start deadline leaves no 76s
        // preflight window after a full reconcile phase.
        refundDeadlineMs: 1_120_000,
        // Three steps fit after the margin, the reserved notification
        // share, and the handoff slack; the remainder retries on the
        // next invocation.
        limit: 3,
        sendCancellationEmail: mocks.sendEmail,
      })
    );
    // Both workers share the bounded 60s reconcile phase so the serial
    // drains behind them keep their share of the invocation budget;
    // the row-start gate sits two 8s provider reads inside it so
    // the final row's overrun still ends the phase within budget.
    expect(
      mocks.reconcilePendingPaystackCancellationRefunds
    ).toHaveBeenCalledWith(supabase, 25, 1_044_000);
    expect(
      mocks.reconcileCompletedPaystackCancellationRefunds
    ).toHaveBeenCalledWith(supabase, 25, 1_044_000);
    expect(mocks.sweepPaystackRefundRecoveryWatches).toHaveBeenCalledWith(
      supabase,
      25,
      1_044_000
    );
    expect(mocks.drainPaystackRefundNotifications).toHaveBeenCalledWith(
      supabase,
      mocks.sendEmail,
      1,
      mocks.notifyMerchant,
      1_270_000
    );
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ skippedDueToBudget: false, success: true })
    );
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
    ['refund watch sweep', 'sweepPaystackRefundRecoveryWatches'],
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

  it('warns instead of 503ing when notifications dead-lettered with zero send failures', async () => {
    mocks.drainPaystackRefundNotifications.mockResolvedValueOnce({
      claimed: 0,
      exhausted: 2,
      failed: 0,
      sent: 0,
    });
    const response = await processCancellationDrain(
      supabase,
      mocks.sendEmail,
      mocks.notifyMerchant
    );
    const payload = await response.json();

    // Dead letters need manual review with no ack path: 503ing would
    // pin the cron red until a human clears them, masking fresh
    // failures. They stay visible via the warn log and payload count.
    expect(response.status).toBe(200);
    expect(payload).toEqual(
      expect.objectContaining({
        success: true,
        paystackRefundNotifications: expect.objectContaining({
          exhausted: 2,
        }),
      })
    );
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ notificationExhausted: 2 })
    );
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });

  it('warns on the success path when notifications are uncertain', async () => {
    mocks.drainPaystackRefundNotifications.mockResolvedValueOnce({
      claimed: 1,
      exhausted: 0,
      failed: 0,
      sent: 0,
      uncertain: 3,
    });
    const response = await processCancellationDrain(
      supabase,
      mocks.sendEmail,
      mocks.notifyMerchant
    );
    const payload = await response.json();

    // Uncertain rows need manual review like dead letters: a 200
    // without a log signal would be visible only to payload
    // parsers, so the success path warns for them too.
    expect(response.status).toBe(200);
    expect(payload).toEqual(
      expect.objectContaining({
        success: true,
        paystackRefundNotifications: expect.objectContaining({
          uncertain: 3,
        }),
      })
    );
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ notificationUncertain: 3 })
    );
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });

  it('logs a missing exhausted count as zero on the failure path', async () => {
    mocks.drainFailedOrderCancellationSideEffects.mockResolvedValueOnce({
      drained: [],
      failed: [{ orderId: 'order-1', reason: 'failed', step: 'refund' }],
      skipped: [],
    });
    mocks.drainPaystackRefundNotifications.mockResolvedValueOnce({
      claimed: 1,
      failed: 0,
      sent: 1,
    });
    const response = await processCancellationDrain(
      supabase,
      mocks.sendEmail,
      mocks.notifyMerchant
    );

    expect(response.status).toBe(503);
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ notificationExhausted: 0 })
    );
  });
});
