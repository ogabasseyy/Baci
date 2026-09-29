import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recoverUnknownPaystackRefund } from './recover-unknown-paystack-refund';
import { recoverUnknownPaystackRefundTestKit } from './recover-unknown-paystack-refund.test-helpers';

const { database, order } = recoverUnknownPaystackRefundTestKit;

const mocks = vi.hoisted(() => ({
  fetchPaystackPaymentById: vi.fn(),
  fetchRefund: vi.fn(),
  fileRefundEvidenceReview: vi.fn(),
  holdPaystackRefundForReview: vi.fn(),
  loggerInfo: vi.fn(),
  reconcilePaystackCancellationRefund: vi.fn(),
}));

vi.mock('./fetch-paystack-payment-by-id', () => ({
  fetchPaystackPaymentById: mocks.fetchPaystackPaymentById,
}));

vi.mock('./fetch-paystack-refund', () => ({
  fetchRefund: mocks.fetchRefund,
}));
vi.mock('./reconcile-paystack-cancellation-refund', () => ({
  reconcilePaystackCancellationRefund:
    mocks.reconcilePaystackCancellationRefund,
}));
vi.mock('./file-refund-evidence-review', () => ({
  fileRefundEvidenceReview: mocks.fileRefundEvidenceReview,
}));
vi.mock('./hold-paystack-refund-for-review', () => ({
  holdPaystackRefundForReview: mocks.holdPaystackRefundForReview,
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: mocks.loggerInfo, warn: vi.fn() },
}));

describe('recoverUnknownPaystackRefund', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchRefund.mockResolvedValue({
      data: {
        amount: 10000,
        currency: 'NGN',
        id: 202,
        status: 'processed',
        transaction: 555,
      },
      success: true,
    });
    mocks.fetchPaystackPaymentById.mockResolvedValue({
      data: { id: 555, reference: 'PSK-1' },
      success: true,
    });
    mocks.reconcilePaystackCancellationRefund.mockResolvedValue('updated');
  });

  it('records and reconciles a verified replacement refund', async () => {
    const { insert, supabase } = database();

    await recoverUnknownPaystackRefund(supabase, 202, 'PSK-1');

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 100,
        currency: 'NGN',
        description: 'Refund for cancelled order #B-1',
        gateway: 'paystack',
        gateway_reference: '202',
        merchant_id: 'merchant-1',
        metadata: {
          payment_transaction_id: 'pay-1',
          provider_payment_transaction_id: 555,
          provider_refund_status: 'processed',
          recovered_from_provider_event: true,
        },
        order_id: 'order-1',
        status: 'refund_pending',
        transaction_type: 'refund',
      })
    );
    expect(mocks.reconcilePaystackCancellationRefund).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({
        gateway_reference: '202',
        merchant_id: 'merchant-1',
        order_id: 'order-1',
      })
    );
    expect(mocks.fileRefundEvidenceReview).not.toHaveBeenCalled();
  });

  it('derives the reference from a provider payment for an ID-only event', async () => {
    const { insert, supabase } = database();

    await recoverUnknownPaystackRefund(supabase, 202);

    expect(mocks.fetchPaystackPaymentById).toHaveBeenCalledWith(
      555,
      expect.any(AbortSignal)
    );
    expect(insert).toHaveBeenCalledOnce();
  });

  it('recovers through a stale webhook reference using the authoritative payment', async () => {
    const { insert, supabase } = database();

    await recoverUnknownPaystackRefund(supabase, 202, 'STALE-REF');

    expect(mocks.fetchPaystackPaymentById).toHaveBeenCalledWith(
      555,
      expect.any(AbortSignal)
    );
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        gateway_reference: '202',
        metadata: expect.objectContaining({
          payment_transaction_id: 'pay-1',
          provider_payment_transaction_id: 555,
        }),
      })
    );
    expect(mocks.reconcilePaystackCancellationRefund).toHaveBeenCalledOnce();
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ refundId: 202 })
    );
  });

  it('fails retryably when the numeric payment lookup is unavailable', async () => {
    mocks.fetchPaystackPaymentById.mockResolvedValue({ success: false });
    const { insert, supabase } = database();

    await expect(recoverUnknownPaystackRefund(supabase, 202)).rejects.toThrow(
      'paystack_refund_payment_lookup_unavailable'
    );
    expect(insert).not.toHaveBeenCalled();
  });

  it('never links a refund to a different numeric provider payment', async () => {
    mocks.fetchPaystackPaymentById.mockResolvedValue({
      data: { id: 999, reference: 'PSK-1' },
      success: true,
    });
    const { insert, supabase } = database();

    await expect(recoverUnknownPaystackRefund(supabase, 202)).rejects.toThrow(
      'paystack_refund_payment_lookup_mismatch'
    );
    expect(insert).not.toHaveBeenCalled();
  });

  it('reconciles the winning row when a concurrent event records first', async () => {
    const raced = {
      amount: 100,
      currency: 'NGN',
      gateway_reference: '202',
      id: 'refund-raced',
      merchant_id: 'merchant-1',
      metadata: {},
      order_id: 'order-1',
      status: 'refund_pending',
    };
    const { supabase } = database({
      insertError: { code: '23505' },
      racedRow: raced,
    });

    await recoverUnknownPaystackRefund(supabase, 202, 'PSK-1');

    expect(mocks.reconcilePaystackCancellationRefund).toHaveBeenCalledWith(
      supabase,
      raced
    );
  });

  it('files a review for refunds on orders that are not cancelled', async () => {
    const { insert, supabase } = database({
      orderRow: { ...order, cancelled_at: null },
    });

    await recoverUnknownPaystackRefund(supabase, 202, 'PSK-1');

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'provider_refund_outside_cancellation',
        merchant_id: 'merchant-1',
        order_id: 'order-1',
        paystack_ref: null,
        metadata: expect.objectContaining({
          payment_transaction_id: 'pay-1',
          provider_payment_transaction_id: 555,
          provider_refund_id: 202,
          refund_evidence: expect.objectContaining({
            'provider:202': expect.objectContaining({
              payment_transaction_id: 'pay-1',
            }),
          }),
        }),
      })
    );
    expect(mocks.reconcilePaystackCancellationRefund).not.toHaveBeenCalled();
  });

  it('throws for redelivery when the active-order review cannot be filed', async () => {
    const { supabase } = database({
      insertError: new Error('db down'),
      orderRow: { ...order, cancelled_at: null },
    });

    await expect(
      recoverUnknownPaystackRefund(supabase, 202, 'PSK-1')
    ).rejects.toThrow('active_order_refund_review_failed');
  });

  it('merges a redelivered active-order refund into the open review', async () => {
    const { rpc, supabase } = database({
      insertError: { code: '23505' },
      orderRow: { ...order, cancelled_at: null },
    });

    await recoverUnknownPaystackRefund(supabase, 202, 'PSK-1');

    expect(rpc).toHaveBeenCalledWith(
      'merge_provider_refund_outside_cancellation_evidence_v1',
      expect.objectContaining({
        p_evidence_key: 'provider:202',
        p_order_id: 'order-1',
      })
    );
    expect(mocks.reconcilePaystackCancellationRefund).not.toHaveBeenCalled();
  });

  it('throws when the authoritative payment belongs to another transaction', async () => {
    mocks.fetchRefund.mockResolvedValue({
      data: {
        amount: 10000,
        currency: 'NGN',
        id: 202,
        status: 'processed',
        transaction: 999,
      },
      success: true,
    });
    const { insert, supabase } = database();

    await expect(
      recoverUnknownPaystackRefund(supabase, 202, 'PSK-1')
    ).rejects.toThrow('paystack_refund_payment_lookup_mismatch');
    expect(insert).not.toHaveBeenCalled();
    expect(mocks.reconcilePaystackCancellationRefund).not.toHaveBeenCalled();
  });

  it('throws retryably when provider verification is unavailable', async () => {
    mocks.fetchRefund.mockResolvedValue({
      code: 'NETWORK_ERROR',
      error: 'socket hangup',
      success: false,
    });
    const { insert, supabase } = database();

    await expect(
      recoverUnknownPaystackRefund(supabase, 202, 'PSK-1')
    ).rejects.toThrow('paystack_refund_verification_unavailable');
    expect(insert).not.toHaveBeenCalled();
  });

  it('files a review when the recovered row fails deterministically', async () => {
    mocks.reconcilePaystackCancellationRefund.mockRejectedValue(
      new Error('paystack_refund_evidence_mismatch')
    );
    const { supabase } = database();

    await recoverUnknownPaystackRefund(supabase, 202, 'PSK-1');

    expect(mocks.fileRefundEvidenceReview).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({ gateway_reference: '202' }),
      'paystack_refund_evidence_mismatch'
    );
    expect(mocks.holdPaystackRefundForReview).toHaveBeenCalledWith(
      supabase,
      expect.any(String),
      'paystack_refund_evidence_mismatch'
    );
  });
});
