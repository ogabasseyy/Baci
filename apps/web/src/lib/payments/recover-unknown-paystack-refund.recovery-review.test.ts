import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recoverUnknownPaystackRefund } from './recover-unknown-paystack-refund';

const mocks = vi.hoisted(() => ({
  fetchPaystackPaymentById: vi.fn(),
  fetchRefund: vi.fn(),
  loggerInfo: vi.fn(),
  reconcilePaystackCancellationRefund: vi.fn(),
  verifyTransaction: vi.fn(),
}));

vi.mock('./fetch-paystack-payment-by-id', () => ({
  fetchPaystackPaymentById: mocks.fetchPaystackPaymentById,
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
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: mocks.loggerInfo, warn: vi.fn() },
}));

const firstPayment = {
  amount: 100,
  gateway_reference: 'PSK-1',
  id: 'pay-1',
  merchant_id: 'merchant-1',
  order_id: 'order-1',
};
const secondPayment = {
  amount: 100,
  gateway_reference: 'PSK-1',
  id: 'pay-2',
  merchant_id: 'merchant-2',
  order_id: 'order-2',
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
    is: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data, error }),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
    select: vi.fn().mockReturnThis(),
  };
}

describe('recoverUnknownPaystackRefund recovery reviews', () => {
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
    mocks.fetchPaystackPaymentById.mockResolvedValue({
      data: { id: 555, reference: 'PSK-1' },
      success: true,
    });
    mocks.reconcilePaystackCancellationRefund.mockResolvedValue('updated');
  });

  function reviewInsert(error: unknown = null) {
    return { insert: vi.fn().mockResolvedValue({ error }) };
  }

  it('files one review per order when the reference matches two payments', async () => {
    const firstInsert = reviewInsert();
    const secondInsert = reviewInsert();
    const from = vi
      .fn()
      .mockReturnValueOnce(selectQuery([firstPayment, secondPayment]))
      .mockReturnValueOnce(selectQuery([]))
      .mockReturnValueOnce(firstInsert)
      .mockReturnValueOnce(selectQuery([]))
      .mockReturnValueOnce(secondInsert);
    const supabase = { from } as unknown as SupabaseClient;

    await recoverUnknownPaystackRefund(supabase, 202, 'PSK-1');

    expect(firstInsert.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'order_cancellation_refund_requires_review',
        order_id: 'order-1',
        merchant_id: 'merchant-1',
        paystack_ref: null,
        metadata: expect.objectContaining({
          provider_refund_id: 202,
          provider_payment_transaction_id: 555,
          audit_record_failed: true,
        }),
        candidates: [
          expect.objectContaining({ payment_transaction_id: 'pay-1' }),
          expect.objectContaining({ payment_transaction_id: 'pay-2' }),
        ],
      })
    );
    expect(secondInsert.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        order_id: 'order-2',
        merchant_id: 'merchant-2',
      })
    );
    expect(mocks.reconcilePaystackCancellationRefund).not.toHaveBeenCalled();
  });

  it('acknowledges ambiguous redeliveries without refiling open reviews', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(selectQuery([firstPayment, secondPayment]))
      .mockReturnValueOnce(selectQuery([{ id: 'review-1' }]))
      .mockReturnValueOnce(selectQuery([{ id: 'review-2' }]));
    const supabase = { from } as unknown as SupabaseClient;

    await recoverUnknownPaystackRefund(supabase, 202, 'PSK-1');

    expect(from).toHaveBeenCalledTimes(3);
  });

  it('files the provider evidence when the audit collides with a non-refund row', async () => {
    const auditInsert = vi.fn().mockResolvedValue({ error: { code: '23505' } });
    const review = reviewInsert();
    const from = vi
      .fn()
      .mockReturnValueOnce(selectQuery([firstPayment]))
      .mockReturnValueOnce(selectQuery(order))
      .mockReturnValueOnce({ insert: auditInsert })
      .mockReturnValueOnce(selectQuery(null))
      .mockReturnValueOnce(selectQuery([]))
      .mockReturnValueOnce(review);
    const supabase = { from } as unknown as SupabaseClient;

    await recoverUnknownPaystackRefund(supabase, 202, 'PSK-1');

    expect(review.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'order_cancellation_refund_requires_review',
        order_id: 'order-1',
        paystack_ref: '202',
        metadata: expect.objectContaining({
          provider_refund_id: 202,
          provider_payment_transaction_id: 555,
          payment_transaction_id: 'pay-1',
          audit_record_failed: true,
        }),
      })
    );
    expect(mocks.reconcilePaystackCancellationRefund).not.toHaveBeenCalled();
  });

  it('treats a lost review race as filed instead of failing redelivery', async () => {
    const auditInsert = vi.fn().mockResolvedValue({ error: { code: '23505' } });
    const review = reviewInsert({ code: '23505' });
    const from = vi
      .fn()
      .mockReturnValueOnce(selectQuery([firstPayment]))
      .mockReturnValueOnce(selectQuery(order))
      .mockReturnValueOnce({ insert: auditInsert })
      .mockReturnValueOnce(selectQuery(null))
      .mockReturnValueOnce(selectQuery([]))
      .mockReturnValueOnce(review);
    const supabase = { from } as unknown as SupabaseClient;

    await recoverUnknownPaystackRefund(supabase, 202, 'PSK-1');

    expect(review.insert).toHaveBeenCalledTimes(1);
  });

  it('throws when the recovery review cannot be persisted', async () => {
    const auditInsert = vi.fn().mockResolvedValue({ error: { code: '23505' } });
    const review = reviewInsert({ code: 'XX000' });
    const from = vi
      .fn()
      .mockReturnValueOnce(selectQuery([firstPayment]))
      .mockReturnValueOnce(selectQuery(order))
      .mockReturnValueOnce({ insert: auditInsert })
      .mockReturnValueOnce(selectQuery(null))
      .mockReturnValueOnce(selectQuery([]))
      .mockReturnValueOnce(review);
    const supabase = { from } as unknown as SupabaseClient;

    await expect(
      recoverUnknownPaystackRefund(supabase, 202, 'PSK-1')
    ).rejects.toThrow('refund_recovery_review_failed');
  });
});
