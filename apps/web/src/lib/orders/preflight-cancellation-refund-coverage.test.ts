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

  it('leaves uncovered non-Paystack legs to the merchant on a cancel-only order', async () => {
    const korapay = {
      ...paystackPayment,
      gateway: 'korapay',
      id: 'payment-2',
      gateway_reference: 'kora-ref',
    };
    const result = await preflightCancellationRefundCoverage(
      input({
        allLegs: [paystackPayment, korapay],
        linkLegs: [paystackPayment, korapay],
        order: { ...order, cancellation_refund_mode: 'manual' },
        soleCompletedLeg: undefined,
        transactions: [paystackPayment, korapay],
      })
    );
    expect(quarantineRefund).not.toHaveBeenCalled();
    expect(result.manualPendingLegIds.has('payment-2')).toBe(true);
  });

  it('still quarantines uncovered non-Paystack legs on an automatic order', async () => {
    const korapay = {
      ...paystackPayment,
      gateway: 'korapay',
      id: 'payment-2',
      gateway_reference: 'kora-ref',
    };
    await preflightCancellationRefundCoverage(
      input({
        allLegs: [paystackPayment, korapay],
        linkLegs: [paystackPayment, korapay],
        soleCompletedLeg: undefined,
        transactions: [paystackPayment, korapay],
      })
    ).catch(() => undefined);
    expect(quarantineRefund).toHaveBeenCalled();
  });

  it('keeps an unrefunded Paystack capture awaiting the merchant on a cancel-only order', async () => {
    const second = {
      ...paystackPayment,
      id: 'payment-2',
      gateway_reference: 'ref-2',
    };
    const result = await preflightCancellationRefundCoverage(
      input({
        allLegs: [paystackPayment, second],
        linkLegs: [paystackPayment, second],
        order: { ...order, cancellation_refund_mode: 'manual' },
        refundRows: [
          {
            amount: paystackPayment.amount,
            currency: paystackPayment.currency,
            gateway: 'paystack',
            gateway_reference: 'refund-1',
            metadata: {
              payment_transaction_id: paystackPayment.id,
              provider_refund_status: 'processed',
            },
            status: 'completed',
          },
        ],
        soleCompletedLeg: undefined,
        transactions: [paystackPayment, second],
      })
    ).catch((reason: unknown) => reason);
    expect(result).not.toBeInstanceOf(Error);
    const outcome = result as { manualPendingLegIds: Set<string> };
    expect(outcome.manualPendingLegIds.has('payment-2')).toBe(true);
    expect(outcome.manualPendingLegIds.has(paystackPayment.id)).toBe(false);
  });

  it('waits for the provider on a cancel-only order whose leg refund is pending', async () => {
    const pending = { ...paystackPayment, status: 'refund_pending' };
    const error = await preflightCancellationRefundCoverage(
      input({
        allLegs: [pending],
        linkLegs: [pending],
        order: { ...order, cancellation_refund_mode: 'manual' },
        soleCompletedLeg: undefined,
        transactions: [pending],
      })
    ).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(DeferredError);
    expect((error as Error).message).toBe(
      'cancellation_refund_awaiting_provider_completion'
    );
    expect(quarantineRefund).not.toHaveBeenCalled();
  });

  it('waits for a separate pending refund row on a cancel-only order instead of completing or quarantining', async () => {
    const error = await preflightCancellationRefundCoverage(
      input({
        order: { ...order, cancellation_refund_mode: 'manual' },
        refundRows: [
          {
            amount: paystackPayment.amount,
            currency: paystackPayment.currency,
            gateway: 'paystack',
            gateway_reference: '424242',
            metadata: { payment_transaction_id: paystackPayment.id },
            status: 'refund_pending',
          },
        ],
      })
    ).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(DeferredError);
    expect((error as Error).message).toBe(
      'cancellation_refund_awaiting_provider_completion'
    );
    expect(quarantineRefund).not.toHaveBeenCalled();
  });

  it('lets a cancel-only order with fully verified refund coverage reach finalization', async () => {
    const result = await preflightCancellationRefundCoverage(
      input({
        order: { ...order, cancellation_refund_mode: 'manual' },
        refundRows: [
          {
            amount: paystackPayment.amount,
            currency: paystackPayment.currency,
            gateway: 'paystack',
            gateway_reference: '424242',
            metadata: {
              payment_transaction_id: paystackPayment.id,
              provider_refund_status: 'processed',
            },
            status: 'completed',
          },
        ],
      })
    );
    expect(result.refundedPaymentIds.has(paystackPayment.id)).toBe(true);
    expect(result.manualPendingLegIds.size).toBe(0);
    expect(quarantineRefund).not.toHaveBeenCalled();
  });
});
