import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  drainFailedOrderCancellationSideEffects: vi.fn(),
  drainPaystackRefundNotifications: vi.fn(),
  isRefundVerificationPending: vi.fn(),
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
  isRefundVerificationPending: mocks.isRefundVerificationPending,
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

describe('processCancellationDrain budget scheduling', () => {
  const supabase = { from: vi.fn(), rpc: vi.fn() } as never;

  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      mock.mockReset();
    }

    mocks.isRefundVerificationPending.mockResolvedValue(false);
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

  it('caps the reconcile phase when refund verification pends', async () => {
    mocks.isRefundVerificationPending.mockResolvedValue(true);
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      await processCancellationDrain(
        supabase,
        mocks.sendEmail,
        mocks.notifyMerchant
      );
    } finally {
      now.mockRestore();
    }

    // The capped 32s phase ends with the setup allowance plus the
    // 76s preflight budget before the phase end; the row-start gate
    // sits two 8s provider reads inside it.
    expect(mocks.isRefundVerificationPending).toHaveBeenCalledWith(supabase);
    expect(
      mocks.reconcilePendingPaystackCancellationRefunds
    ).toHaveBeenCalledWith(supabase, 25, 1_016_000);
    expect(
      mocks.reconcileCompletedPaystackCancellationRefunds
    ).toHaveBeenCalledWith(supabase, 25, 1_016_000);
    expect(mocks.sweepPaystackRefundRecoveryWatches).toHaveBeenCalledWith(
      supabase,
      25,
      1_016_000
    );
  });

  it('caps the reconcile phase when the verification probe throws', async () => {
    // A transport-level probe outage must fail closed (capped),
    // not abort the whole cron invocation before the drains run.
    mocks.isRefundVerificationPending.mockRejectedValue(
      new Error('transport down')
    );
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      await processCancellationDrain(
        supabase,
        mocks.sendEmail,
        mocks.notifyMerchant
      );
    } finally {
      now.mockRestore();
    }
    expect(
      mocks.reconcilePendingPaystackCancellationRefunds
    ).toHaveBeenCalledWith(supabase, 25, 1_016_000);
    expect(mocks.drainFailedOrderCancellationSideEffects).toHaveBeenCalled();
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
});
