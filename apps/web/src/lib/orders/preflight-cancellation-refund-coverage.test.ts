import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/orders/quarantine-order-cancellation-refund', () => ({
  quarantineRefund: vi.fn(),
}));
vi.mock('@/lib/orders/reset-cancellation-side-effect-attempts', () => ({
  tryResetCancellationSideEffectAttempts: vi.fn(),
}));

import { quarantineRefund } from '@/lib/orders/quarantine-order-cancellation-refund';
import { tryResetCancellationSideEffectAttempts } from '@/lib/orders/reset-cancellation-side-effect-attempts';
import { DeferredError } from '@/lib/orders/run-order-cancellation-side-effect';
import { preflightCancellationRefundCoverage } from './preflight-cancellation-refund-coverage';
import {
  order,
  paystackPayment,
  preflightSupabase,
} from './preflight-cancellation-refund-initiation.test-support';

function input(overrides: Record<string, unknown> = {}) {
  return {
    allLegs: [paystackPayment],
    linkLegs: [paystackPayment],
    order,
    refundRows: [],
    soleCompletedLeg: paystackPayment,
    step: 'refund',
    supabase: preflightSupabase(),
    transactions: [paystackPayment],
    ...overrides,
  } as never;
}

describe('preflightCancellationRefundCoverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes a clean leg through without quarantining', async () => {
    const result = await preflightCancellationRefundCoverage(input());
    expect(result.refundedPaymentIds.size).toBe(0);
    expect(result.mismatchedTransactions).toEqual([]);
    expect(quarantineRefund).not.toHaveBeenCalled();
    expect(typeof result.linkedPaymentId).toBe('function');
  });

  it('quarantines refunds linked to no funded leg', async () => {
    // The unverified provider row also defers for the
    // verification workers; the invalid-link quarantine lands
    // first either way.
    const error = await preflightCancellationRefundCoverage(
      input({
        refundRows: [
          {
            amount: 100,
            currency: 'NGN',
            gateway: 'paystack',
            gateway_reference: '424242',
            metadata: { payment_transaction_id: 'payment-unknown' },
            status: 'completed',
          },
        ],
      })
    ).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(DeferredError);
    expect(quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          invalid_link_claimed_payment_ids: expect.anything(),
        }),
        preflight: true,
      })
    );
  });

  it('quarantines unlinked refunds without sole-leg cover', async () => {
    await preflightCancellationRefundCoverage(
      input({
        refundRows: [
          {
            amount: 100,
            currency: 'NGN',
            gateway: 'paystack',
            gateway_reference: '424242',
            metadata: {},
            status: 'completed',
          },
        ],
        soleCompletedLeg: null,
      })
    );
    expect(quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: expect.stringContaining('cannot be linked'),
      })
    );
  });

  it('quarantines uncovered reference-less legs', async () => {
    const referenceLess = { ...paystackPayment, gateway_reference: '' };
    await preflightCancellationRefundCoverage(
      input({
        allLegs: [referenceLess],
        linkLegs: [referenceLess],
        soleCompletedLeg: referenceLess,
        transactions: [referenceLess],
      })
    );
    expect(quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: expect.stringContaining('requires review'),
      })
    );
  });

  it('quarantines previously accepted non-terminal refunds', async () => {
    await preflightCancellationRefundCoverage(
      input({
        refundRows: [
          {
            amount: 100,
            currency: 'NGN',
            gateway: 'paystack',
            gateway_reference: '424242',
            metadata: { payment_transaction_id: 'payment-1' },
            status: 'pending',
          },
        ],
      })
    );
    expect(quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'A previously accepted cancellation refund is not terminal',
      })
    );
  });

  it('defers fresh when every leg awaits provider completion', async () => {
    const supabase = preflightSupabase();
    const error = await preflightCancellationRefundCoverage(
      input({
        supabase,
        transactions: [{ ...paystackPayment, status: 'refund_pending' }],
      })
    ).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(DeferredError);
    expect(tryResetCancellationSideEffectAttempts).toHaveBeenCalledWith(
      supabase,
      'order-1',
      'refund'
    );
  });
});
