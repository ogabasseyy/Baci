import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  initiateRefund: vi.fn(),
}));

vi.mock('@/lib/orders/check-cancellation-refund-provider', () => ({
  checkCancellationRefundProvider: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/initiate-paystack-refund', () => ({
  initiateRefund: mocks.initiateRefund,
}));

import { executeOrderCancellationSideEffect } from './execute-order-cancellation-side-effect';
import {
  merchant,
  order,
  paystackPayment,
  refundClient,
} from './execute-order-cancellation-side-effect.test-support';
import {
  DeferredError,
  DeliveryUncertainError,
} from './run-order-cancellation-side-effect';

describe('cancellation refund preflight guards', () => {
  beforeEach(() => vi.clearAllMocks());

  it('quarantines overfunded ledgers instead of retrying them', async () => {
    const supabase = refundClient({
      payments: [{ ...paystackPayment, amount: 101 }],
    });
    // An overfunded ledger cannot be repaired by retrying, so the step
    // files durable reconciliation evidence and ends delivery_uncertain
    // instead of burning the five-attempt budget on a plain error.
    await expect(
      executeOrderCancellationSideEffect({
        merchant,
        order,
        step: 'refund',
        supabase: supabase as never,
      })
    ).rejects.toBeInstanceOf(DeliveryUncertainError);
    expect(supabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'order_cancellation_refund_requires_review',
        reason: expect.stringContaining('exceed the recorded amount paid'),
      })
    );
    expect(mocks.initiateRefund).not.toHaveBeenCalled();
  });

  it('requires review when a payment leg currency differs from the order currency', async () => {
    const supabase = refundClient({
      payments: [{ ...paystackPayment, currency: 'USD' }],
    });
    await expect(
      executeOrderCancellationSideEffect({
        merchant,
        order,
        step: 'refund',
        supabase: supabase as never,
      })
    ).rejects.toThrow('Payment currency requires review before refund');
    expect(mocks.initiateRefund).not.toHaveBeenCalled();
  });

  it('refunds the clean leg then quarantines a settled foreign-currency leg', async () => {
    // The settled USD leg never passed the initiation-time currency
    // gate, but the SQL gates reject its terminal row as anomalous:
    // resolving here would complete the side effect while the order
    // can never finalize. The clean sibling still refunds first.
    const supabase = refundClient({
      payments: [
        {
          ...paystackPayment,
          id: 'payment-usd',
          gateway_reference: 'ref-usd',
          currency: 'USD',
        },
        {
          ...paystackPayment,
          id: 'payment-2',
          gateway_reference: 'ref-2',
          amount: 40,
        },
      ],
      refundRows: [
        {
          amount: 100,
          currency: 'USD',
          gateway: 'paystack',
          metadata: {
            payment_transaction_id: 'payment-usd',
            provider_refund_status: 'processed',
          },
          status: 'completed',
        },
      ],
    });
    mocks.initiateRefund.mockResolvedValue({
      data: {
        id: 45,
        status: 'processed',
        transaction: { id: 125, reference: 'ref-2' },
      },
      success: true,
    });

    await expect(
      executeOrderCancellationSideEffect({
        merchant,
        order,
        step: 'refund',
        supabase: supabase as never,
      })
    ).rejects.toThrow('Payment currency requires review before refund');
    expect(mocks.initiateRefund).toHaveBeenCalledTimes(1);
    expect(mocks.initiateRefund).toHaveBeenCalledWith(
      'ref-2',
      4000,
      'Order cancelled',
      undefined
    );
  });

  it('defers a partial manual record instead of completing it', async () => {
    // A partial manual record waits for the merchant: the worker must
    // neither initiate the leg (double refund) nor quarantine it
    // (which would lock the merchant out of finishing manually) —
    // and must not complete either, or the final manual record would
    // land on a completed row no drain reselects, stranding the
    // trusted aggregate finalization.
    const supabase = refundClient({
      payments: [paystackPayment],
      refundRows: [
        {
          amount: 20,
          currency: 'NGN',
          gateway: 'manual',
          metadata: { payment_transaction_id: 'payment-1' },
          status: 'completed',
        },
      ],
    });
    const error = await executeOrderCancellationSideEffect({
      merchant,
      order,
      step: 'refund',
      supabase: supabase as never,
    }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(DeferredError);
    expect((error as Error).message).toBe(
      'cancellation_refund_awaiting_manual_completion'
    );
    expect(mocks.initiateRefund).not.toHaveBeenCalled();
    expect(supabase.insert).not.toHaveBeenCalled();
    expect(supabase.update).toHaveBeenCalledWith({ attempts: 0 });
  });
  it('treats legacy refunded rows as terminal coverage', async () => {
    const supabase = refundClient({
      payments: [paystackPayment],
      refundRows: [
        {
          amount: 100,
          currency: 'NGN',
          gateway: 'paystack',
          metadata: {
            payment_transaction_id: 'payment-1',
            provider_refund_status: 'processed',
          },
          status: 'refunded',
        },
      ],
    });
    await expect(
      executeOrderCancellationSideEffect({
        merchant,
        order,
        step: 'refund',
        supabase: supabase as never,
      })
    ).resolves.toEqual({ refundIds: [] });
    expect(mocks.initiateRefund).not.toHaveBeenCalled();
    expect(supabase.insert).not.toHaveBeenCalled();
  });

  it('defers a manual on a cash leg instead of misreading its link', async () => {
    // The merchant RPC allocates manual money to cash legs (they have
    // no auto-reversal): the worker must validate that link against
    // the full leg universe and defer for the merchant, not quarantine
    // it as pointing outside the order.
    const supabase = refundClient({
      payments: [
        { ...paystackPayment, amount: 60 },
        {
          ...paystackPayment,
          amount: 40,
          gateway: 'cash',
          id: 'payment-cash',
        },
      ],
      refundRows: [
        {
          amount: 60,
          currency: 'NGN',
          gateway: 'paystack',
          metadata: {
            payment_transaction_id: 'payment-1',
            provider_refund_status: 'processed',
          },
          status: 'completed',
        },
        {
          amount: 10,
          currency: 'NGN',
          gateway: 'manual',
          metadata: { payment_transaction_id: 'payment-cash' },
          status: 'completed',
        },
      ],
    });
    const error = await executeOrderCancellationSideEffect({
      merchant,
      order,
      step: 'refund',
      supabase: supabase as never,
    }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(DeferredError);
    expect((error as Error).message).toBe(
      'cancellation_refund_awaiting_manual_completion'
    );
    expect(mocks.initiateRefund).not.toHaveBeenCalled();
    expect(supabase.insert).not.toHaveBeenCalled();
  });
});
