import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  alertPendingRefundReviews: vi.fn(),
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
vi.mock('@/lib/orders/alert-pending-refund-reviews', () => ({
  alertPendingRefundReviews: mocks.alertPendingRefundReviews,
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

import type { RefundAlertPassSummary } from '@/lib/orders/refund-alert-types';
import { processCancellationDrain } from './process-cancellation-drain';

const counts: RefundAlertPassSummary = {
  alerted: 1,
  attempted: 3,
  deferred: 0,
  duplicate: 0,
  failed: 1,
  uncertain: 1,
  undeliverable: 0,
};

describe('processCancellationDrain merchant alerts', () => {
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

  it('still runs the merchant alert pass when the side-effect drain rejects', async () => {
    mocks.alertPendingRefundReviews.mockResolvedValue(counts);
    mocks.drainFailedOrderCancellationSideEffects.mockRejectedValue(
      new Error('cancellation_side_effect_lookup_failed')
    );
    await processCancellationDrain(
      supabase,
      mocks.sendEmail,
      mocks.notifyMerchant
    );
    expect(mocks.alertPendingRefundReviews).toHaveBeenCalledTimes(1);
  });

  it('reports merchant alert counts in the success payload and warns on failures', async () => {
    mocks.alertPendingRefundReviews.mockResolvedValue(counts);
    const response = await processCancellationDrain(
      supabase,
      mocks.sendEmail,
      mocks.notifyMerchant
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ merchantRefundAlerts: counts })
    );
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ failed: 1 })
    );
  });

  it('caps the alert pass and sizes notification sends from the pre-alert time', async () => {
    let now = 1_000_000;
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    mocks.alertPendingRefundReviews.mockImplementation(async () => {
      now += 130_000; // a slow alert pass
      return counts;
    });
    try {
      await processCancellationDrain(
        supabase,
        mocks.sendEmail,
        mocks.notifyMerchant
      );
      const { deadlineMs } = mocks.alertPendingRefundReviews.mock.calls[0][0];
      expect(deadlineMs).toBeLessThanOrEqual(1_000_000 + 20_000);
      // Derived from the pre-alert timestamp: still one send fits.
      expect(mocks.drainPaystackRefundNotifications.mock.calls[0][2]).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});
