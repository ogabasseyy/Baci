import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/orders/initiate-paystack-cancellation-refunds', () => ({
  initiatePaystackCancellationRefunds: vi.fn().mockResolvedValue([11, 22]),
}));
vi.mock('@/lib/orders/quarantine-withheld-cancellation-refund-legs', () => ({
  quarantineWithheldCancellationRefundLegs: vi
    .fn()
    .mockResolvedValue(undefined),
}));
vi.mock('@/lib/orders/reset-cancellation-side-effect-attempts', () => ({
  tryResetCancellationSideEffectAttempts: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/orders/quarantine-order-cancellation-refund', () => ({
  quarantineRefund: vi.fn(),
}));

import { initiatePaystackCancellationRefunds } from '@/lib/orders/initiate-paystack-cancellation-refunds';
import { quarantineRefund } from '@/lib/orders/quarantine-order-cancellation-refund';
import { quarantineWithheldCancellationRefundLegs } from '@/lib/orders/quarantine-withheld-cancellation-refund-legs';
import { tryResetCancellationSideEffectAttempts } from '@/lib/orders/reset-cancellation-side-effect-attempts';
import {
  DeferredError,
  DeliveryUncertainError,
} from '@/lib/orders/run-order-cancellation-side-effect';
import {
  order,
  paystackPayment,
} from './execute-order-cancellation-side-effect.test-support';
import { settleCancellationRefundInitiation } from './settle-cancellation-refund-initiation';

function input(overrides: Record<string, unknown> = {}) {
  return {
    auditBlockedTransactions: [],
    initiationTransactions: [],
    manualPendingLegIds: new Set<string>(),
    mismatchedTransactions: [],
    order: order as never,
    refundedPaymentIds: new Set<string>(),
    step: 'refund' as const,
    supabase: {} as never,
    verifiedManualPaystackLegIds: [],
    ...overrides,
  };
}

describe('settleCancellationRefundInitiation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('initiates clean legs and completes when nothing pends', async () => {
    const result = await settleCancellationRefundInitiation(
      input({ initiationTransactions: [paystackPayment as never] })
    );
    expect(result).toEqual({ refundIds: [11, 22] });
    expect(initiatePaystackCancellationRefunds).toHaveBeenCalledWith(
      expect.objectContaining({
        transactions: [paystackPayment],
      })
    );
    expect(quarantineWithheldCancellationRefundLegs).toHaveBeenCalledWith(
      expect.objectContaining({ mismatchedTransactions: [] })
    );
    expect(tryResetCancellationSideEffectAttempts).not.toHaveBeenCalled();
  });

  it('withholds verified legs from the blind quarantine but still defers', async () => {
    const verified = { ...paystackPayment, id: 'payment-2' };
    const error = await settleCancellationRefundInitiation(
      input({
        mismatchedTransactions: [paystackPayment, verified] as never,
        verifiedManualPaystackLegIds: ['payment-2'],
      })
    ).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(DeferredError);
    // The unverified mismatch still quarantines; the verified leg
    // does not — its stamped proof re-derives next run.
    expect(quarantineWithheldCancellationRefundLegs).toHaveBeenCalledWith(
      expect.objectContaining({
        mismatchedTransactions: [paystackPayment],
      })
    );
    expect(tryResetCancellationSideEffectAttempts).toHaveBeenCalled();
  });

  it('defers under pending manuals without verified legs', async () => {
    const error = await settleCancellationRefundInitiation(
      input({ manualPendingLegIds: new Set(['payment-3']) })
    ).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(DeferredError);
    expect((error as Error).message).toBe(
      'cancellation_refund_awaiting_manual_completion'
    );
  });
  it('defers after initiating a budget-short verified prefix', async () => {
    // The subset initiated above; completing now would strand the
    // unverified remainder behind a terminal row no drain reselects.
    const error = await settleCancellationRefundInitiation(
      input({
        budgetDeferred: true,
        initiationTransactions: [paystackPayment as never],
      })
    ).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(DeferredError);
    expect((error as Error).message).toBe(
      'cancellation_refund_preflight_deferred_for_budget'
    );
    expect(initiatePaystackCancellationRefunds).toHaveBeenCalledWith(
      expect.objectContaining({
        transactions: [paystackPayment],
      })
    );
    expect(tryResetCancellationSideEffectAttempts).toHaveBeenCalled();
  });
  it('withholds budget-skipped manuals from the quarantine but still defers', async () => {
    const skipped = { ...paystackPayment, id: 'payment-2' };
    const error = await settleCancellationRefundInitiation(
      input({
        budgetDeferred: true,
        budgetSkippedManualLegIds: ['payment-2'],
        mismatchedTransactions: [paystackPayment, skipped] as never,
      })
    ).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(DeferredError);
    expect((error as Error).message).toBe(
      'cancellation_refund_preflight_deferred_for_budget'
    );
    // The genuine mismatch still quarantines; the skipped claim
    // resumes verification next run instead of terminalizing.
    expect(quarantineWithheldCancellationRefundLegs).toHaveBeenCalledWith(
      expect.objectContaining({
        mismatchedTransactions: [paystackPayment],
      })
    );
  });
  it('quarantines a settled foreign-currency leg instead of completing silently', async () => {
    // The settled leg never passed the initiation-time currency
    // gate (it scopes to outstanding legs), but the SQL gates
    // reject its terminal row as anomalous: completing would
    // strand the order with no reclaimable side-effect row. Clean
    // siblings initiate first then the evidence quarantines.
    const foreignLeg = { ...paystackPayment, currency: 'USD', id: 'payment-9' };
    vi.mocked(quarantineRefund).mockRejectedValueOnce(
      new DeliveryUncertainError('Payment currency requires review')
    );
    const error = await settleCancellationRefundInitiation(
      input({
        initiationTransactions: [paystackPayment, foreignLeg] as never,
        refundedPaymentIds: new Set(['payment-9']),
      })
    ).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(DeliveryUncertainError);
    expect(initiatePaystackCancellationRefunds).toHaveBeenCalledWith(
      expect.objectContaining({
        transactions: [paystackPayment, foreignLeg],
      })
    );
    expect(quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'Payment currency requires review before refund',
        transactions: [foreignLeg],
      })
    );
  });
});
