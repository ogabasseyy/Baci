import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recoverUnknownPaystackRefund } from './recover-unknown-paystack-refund';

const mocks = vi.hoisted(() => ({
  fetchRefund: vi.fn(),
  fileRefundEvidenceReview: vi.fn(),
  holdPaystackRefundForReview: vi.fn(),
  loggerInfo: vi.fn(),
  reconcilePaystackCancellationRefund: vi.fn(),
  verifyTransaction: vi.fn(),
}));

vi.mock('./fetch-paystack-refund', () => ({
  fetchRefund: mocks.fetchRefund,
}));
vi.mock('@/lib/verify-paystack-transaction', () => ({
  verifyTransaction: mocks.verifyTransaction,
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

const payment = {
  amount: 100,
  gateway_reference: 'PSK-1',
  id: 'pay-1',
  merchant_id: 'merchant-1',
  order_id: 'order-1',
};
const order = {
  cancelled_at: '2026-09-27T00:00:00Z',
  id: 'order-1',
  order_number: 'B-1',
  shipping_status: 'cancelled',
};

function selectQuery(data: unknown, error: unknown = null) {
  return {
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data, error }),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
    select: vi.fn().mockReturnThis(),
  };
}

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
    mocks.verifyTransaction.mockResolvedValue({
      data: {
        amount: 10000,
        currency: 'NGN',
        id: 555,
        reference: 'PSK-1',
      },
      success: true,
    });
    mocks.reconcilePaystackCancellationRefund.mockResolvedValue('updated');
  });

  function database({
    insertError = null,
    orderRow = order,
    paymentRows = [payment],
    racedRow = null,
  }: {
    insertError?: unknown;
    orderRow?: unknown;
    paymentRows?: unknown[];
    racedRow?: unknown;
  } = {}) {
    const insert = vi.fn().mockResolvedValue({ error: insertError });
    const from = vi
      .fn()
      .mockReturnValueOnce(selectQuery(paymentRows))
      .mockReturnValueOnce(selectQuery(orderRow))
      .mockReturnValueOnce({ insert })
      .mockReturnValueOnce(selectQuery(racedRow));
    return { from, insert, supabase: { from } as unknown as SupabaseClient };
  }

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

  it('acknowledges refunds for orders that are not cancelled', async () => {
    const { insert, supabase } = database({
      orderRow: { ...order, cancelled_at: null },
    });

    await recoverUnknownPaystackRefund(supabase, 202, 'PSK-1');

    expect(insert).not.toHaveBeenCalled();
    expect(mocks.reconcilePaystackCancellationRefund).not.toHaveBeenCalled();
  });

  it('acknowledges events whose refund does not match the payment', async () => {
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

    await recoverUnknownPaystackRefund(supabase, 202, 'PSK-1');

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
