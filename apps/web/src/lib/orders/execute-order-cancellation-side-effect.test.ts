import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  initiateRefund: vi.fn(),
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
import { DeliveryUncertainError } from './run-order-cancellation-side-effect';

describe('executeOrderCancellationSideEffect', () => {
  beforeEach(() => vi.clearAllMocks());

  it('records a successful Paystack refund', async () => {
    const supabase = refundClient();
    mocks.initiateRefund.mockResolvedValue({
      data: {
        id: 42,
        status: 'processed',
        transaction: { id: 123, reference: 'ref-1' },
      },
      success: true,
    });

    await expect(
      executeOrderCancellationSideEffect({
        merchant,
        order,
        reason: 'Unavailable',
        step: 'refund',
        supabase: supabase as never,
      })
    ).resolves.toEqual({ refundIds: [42] });
    expect(supabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 100,
        status: 'refund_pending',
        metadata: expect.objectContaining({
          payment_transaction_id: 'payment-1',
          provider_payment_transaction_id: 123,
        }),
        transaction_type: 'refund',
      })
    );
    expect(supabase.paymentLookup.eq).toHaveBeenCalledWith(
      'merchant_id',
      'merchant-1'
    );
  });

  it('refunds only the completed gateway-funded portion', async () => {
    const supabase = refundClient({
      payments: [{ ...paystackPayment, amount: 60 }],
    });
    mocks.initiateRefund.mockResolvedValue({
      data: {
        id: 43,
        status: 'processed',
        transaction: { id: 123, reference: 'ref-1' },
      },
      success: true,
    });

    await executeOrderCancellationSideEffect({
      merchant,
      order,
      step: 'refund',
      supabase: supabase as never,
    });

    expect(mocks.initiateRefund).toHaveBeenCalledWith(
      'ref-1',
      6000,
      'Order cancelled',
      undefined
    );
    expect(supabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 60, transaction_type: 'refund' })
    );
  });

  it('refunds every completed gateway payment without replaying recorded legs', async () => {
    const supabase = refundClient({
      payments: [
        paystackPayment,
        {
          ...paystackPayment,
          amount: 40,
          gateway_reference: 'ref-2',
          id: 'payment-2',
        },
      ],
      refundRows: [
        {
          amount: 100,
          currency: 'NGN',
          gateway: 'paystack',
          metadata: {
            payment_transaction_id: 'payment-1',
            provider_refund_status: 'processed',
          },
          status: 'completed',
        },
      ],
    });
    mocks.initiateRefund.mockResolvedValue({
      data: {
        id: 44,
        status: 'processed',
        transaction: { id: 124, reference: 'ref-2' },
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
    ).resolves.toEqual({ refundIds: [44] });

    expect(mocks.initiateRefund).toHaveBeenCalledTimes(1);
    expect(mocks.initiateRefund).toHaveBeenCalledWith(
      'ref-2',
      4000,
      'Order cancelled',
      undefined
    );
    expect(supabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 40,
        metadata: expect.objectContaining({
          payment_transaction_id: 'payment-2',
        }),
      })
    );
  });

  it('rejects a completed gateway transaction with no refundable amount', async () => {
    const supabase = refundClient({
      payments: [{ ...paystackPayment, amount: 0 }],
    });

    await expect(
      executeOrderCancellationSideEffect({
        merchant,
        order,
        step: 'refund',
        supabase: supabase as never,
      })
    ).rejects.toThrow('no refundable amount');
    expect(mocks.initiateRefund).not.toHaveBeenCalled();
  });

  it('quarantines ambiguous Paystack failures', async () => {
    const supabase = refundClient();
    mocks.initiateRefund.mockResolvedValue({
      code: 'NETWORK_ERROR',
      error: 'socket closed',
      success: false,
    });

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
        metadata: expect.objectContaining({
          failed_payment_transaction_id: 'payment-1',
        }),
        txn_id: 'payment-1',
      })
    );
  });

  it('quarantines a first-leg decline instead of burning retries', async () => {
    const supabase = refundClient();
    mocks.initiateRefund.mockResolvedValue({
      error: 'declined',
      success: false,
    });

    const error = await executeOrderCancellationSideEffect({
      merchant,
      order,
      step: 'refund',
      supabase: supabase as never,
    }).catch((reason: unknown) => reason);

    // A deterministic rejection would never succeed on retry: quarantining
    // immediately files the leg for operations instead of burning the
    // five-attempt budget and stranding the customer unrefunded.
    expect(error).toBeInstanceOf(DeliveryUncertainError);
    expect(supabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'order_cancellation_refund_requires_review',
        reason: expect.stringContaining('was rejected for this payment leg'),
      })
    );
  });
});
