import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  initiateRefund: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock('@/lib/initiate-paystack-refund', () => ({
  initiateRefund: mocks.initiateRefund,
}));
vi.mock('@/lib/zeptomail', () => ({ sendEmail: mocks.sendEmail }));
vi.mock('@/lib/orders/build-order-cancellation-email-message', () => ({
  buildOrderCancellationEmailMessage: vi.fn(() => ({
    to: 'buyer@example.com',
  })),
}));

import { executeOrderCancellationSideEffect } from './execute-order-cancellation-side-effect';
import { DeliveryUncertainError } from './run-order-cancellation-side-effect';

const merchant = {
  business_name: 'Store',
  cac_rc_number: null,
  email: 'store@example.com',
  email_sender_name: null,
  id: 'merchant-1',
  slug: 'store',
  support_email: null,
  tax_identification_number: null,
};
const order = {
  amount_paid: 100,
  currency: 'NGN',
  customer_email: 'buyer@example.com',
  customer_id: null,
  customer_name: 'Buyer',
  id: 'order-1',
  merchant_id: 'merchant-1',
  order_items: [],
  order_number: 'ORD-1',
  payment_status: 'paid',
  total: 100,
};

const paystackPayment = {
  amount: 100,
  currency: 'NGN',
  gateway: 'paystack',
  gateway_reference: 'ref-1',
  id: 'payment-1',
};

function transactionQuery(data: unknown) {
  return {
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data, error: null }),
    select: vi.fn().mockReturnThis(),
  };
}

function refundClient({
  insertError = null,
  payments = [paystackPayment],
  refundRows = [],
}: {
  insertError?: Error | null;
  payments?: (typeof paystackPayment)[];
  refundRows?: { metadata: Record<string, unknown>; status: string }[];
} = {}) {
  const insert = vi.fn().mockResolvedValue({ error: insertError });
  const paymentLookup = transactionQuery(payments);
  const from = vi
    .fn()
    .mockReturnValueOnce(paymentLookup)
    .mockReturnValueOnce(transactionQuery(refundRows));
  for (const _payment of payments) {
    from.mockReturnValueOnce({ insert });
  }
  return { from, insert, paymentLookup };
}

describe('executeOrderCancellationSideEffect', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends the cancellation email', async () => {
    mocks.sendEmail.mockResolvedValue({ success: true, messageId: 'msg-1' });

    await expect(
      executeOrderCancellationSideEffect({
        merchant,
        order,
        sendCancellationEmail: mocks.sendEmail,
        step: 'customer_email',
        supabase: { from: vi.fn() } as never,
      })
    ).resolves.toEqual({ messageId: 'msg-1' });
  });

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
      'Order cancelled'
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
          metadata: { payment_transaction_id: 'payment-1' },
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
      'Order cancelled'
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

  it('retries a first-leg decline without filing a review', async () => {
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

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DeliveryUncertainError);
    expect(supabase.insert).not.toHaveBeenCalled();
    expect(supabase.from).toHaveBeenCalledTimes(2);
  });
});
