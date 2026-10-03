import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  drainFailedOrderCancellationSideEffects: vi.fn(),
  drainPaystackRefundNotifications: vi.fn(),
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
      // The zero-limit call still runs: its exhausted/uncertain
      // counts feed the 503 signal. Only the claim loop stands down.
      expect(mocks.drainPaystackRefundNotifications).toHaveBeenCalledWith(
        supabase,
        mocks.sendEmail,
        0,
        mocks.notifyMerchant,
        1_270_000
      );
      expect(mocks.loggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('cron budget exhausted'),
        })
      );
      await expect(response.json()).resolves.toEqual(
        expect.objectContaining({ skippedDueToBudget: true, success: true })
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
      // A zero limit skips the call outright instead of issuing
      // empty select round-trips; the payload substitutes the same
      // empty summary the full settlement path uses.
      expect(
        mocks.drainFailedOrderCancellationSideEffects
      ).not.toHaveBeenCalled();
      expect(mocks.loggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('side-effect drain'),
        })
      );
      await expect(response.json()).resolves.toEqual(
        expect.objectContaining({
          cancellationSideEffectDrain: {
            drained: [],
            failed: [],
            skipped: [],
          },
          notificationSkippedDueToBudget: true,
          sideEffectSkippedDueToBudget: true,
          skippedDueToBudget: true,
          success: true,
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
