import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recoverUnknownPaystackRefund } from './recover-unknown-paystack-refund';

const mocks = vi.hoisted(() => ({
  fetchPaystackPaymentById: vi.fn(),
  fetchRefund: vi.fn(),
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
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
    select: vi.fn().mockReturnThis(),
    // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are thenable.
    then: (resolve: (value: unknown) => void) => resolve({ data, error }),
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
    mocks.fetchPaystackPaymentById.mockResolvedValue({
      data: { id: 555, reference: 'PSK-1' },
      success: true,
    });
    mocks.reconcilePaystackCancellationRefund.mockResolvedValue('updated');
  });

  function reviewRpc(error: unknown = null) {
    return vi.fn().mockResolvedValue({ data: 'review-1', error });
  }

  it('files one review per order when the reference matches two payments', async () => {
    const rpc = reviewRpc();
    const from = vi
      .fn()
      .mockReturnValueOnce(selectQuery([firstPayment, secondPayment]))
      .mockReturnValueOnce(
        selectQuery([order, { ...order, id: 'order-2', order_number: 'B-2' }])
      );
    const supabase = { from, rpc } as unknown as SupabaseClient;

    await recoverUnknownPaystackRefund(supabase, 202, 'PSK-1');

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      'file_paystack_refund_recovery_review_v1',
      expect.objectContaining({
        p_order_id: 'order-1',
        p_merchant_id: 'merchant-1',
        p_paystack_ref: null,
        p_metadata: expect.objectContaining({
          provider_refund_id: 202,
          provider_payment_transaction_id: 555,
          audit_record_failed: true,
          refund_evidence: {
            'provider:202': expect.objectContaining({
              audit_record_failed: true,
            }),
          },
        }),
        p_candidates: [
          expect.objectContaining({ payment_transaction_id: 'pay-1' }),
          expect.objectContaining({ payment_transaction_id: 'pay-2' }),
        ],
      })
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      'file_paystack_refund_recovery_review_v1',
      expect.objectContaining({
        p_order_id: 'order-2',
        p_merchant_id: 'merchant-2',
      })
    );
    expect(mocks.reconcilePaystackCancellationRefund).not.toHaveBeenCalled();
  });

  it('merges redelivered ambiguity evidence into the open reviews', async () => {
    const rpc = reviewRpc();
    const from = vi
      .fn()
      .mockReturnValueOnce(selectQuery([firstPayment, secondPayment]))
      .mockReturnValueOnce(
        selectQuery([order, { ...order, id: 'order-2', order_number: 'B-2' }])
      );
    const supabase = { from, rpc } as unknown as SupabaseClient;

    await recoverUnknownPaystackRefund(supabase, 202, 'PSK-1');

    // The merge moved server-side: redelivery refiles the same evidence
    // payload and the RPC absorbs it into the open reviews.
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith(
      'file_paystack_refund_recovery_review_v1',
      expect.objectContaining({
        p_metadata: expect.objectContaining({
          refund_evidence: expect.objectContaining({
            'provider:202': expect.objectContaining({
              audit_record_failed: true,
            }),
          }),
        }),
      })
    );
  });

  it('files the provider evidence when the audit collides with a non-refund row', async () => {
    const auditInsert = vi.fn().mockResolvedValue({ error: { code: '23505' } });
    const rpc = reviewRpc();
    const from = vi
      .fn()
      .mockReturnValueOnce(selectQuery([firstPayment]))
      .mockReturnValueOnce(selectQuery(order))
      .mockReturnValueOnce({ insert: auditInsert })
      .mockReturnValueOnce(selectQuery(null));
    const supabase = { from, rpc } as unknown as SupabaseClient;

    await recoverUnknownPaystackRefund(supabase, 202, 'PSK-1');

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      'file_paystack_refund_recovery_review_v1',
      expect.objectContaining({
        p_order_id: 'order-1',
        p_paystack_ref: '202',
        p_metadata: expect.objectContaining({
          provider_refund_id: 202,
          provider_payment_transaction_id: 555,
          payment_transaction_id: 'pay-1',
          audit_record_failed: true,
        }),
      })
    );
    expect(mocks.reconcilePaystackCancellationRefund).not.toHaveBeenCalled();
  });

  it('merges a colliding redelivery into the open review instead of failing', async () => {
    const auditInsert = vi.fn().mockResolvedValue({ error: { code: '23505' } });
    const rpc = reviewRpc();
    const from = vi
      .fn()
      .mockReturnValueOnce(selectQuery([firstPayment]))
      .mockReturnValueOnce(selectQuery(order))
      .mockReturnValueOnce({ insert: auditInsert })
      .mockReturnValueOnce(selectQuery(null));
    const supabase = { from, rpc } as unknown as SupabaseClient;

    await recoverUnknownPaystackRefund(supabase, 202, 'PSK-1');

    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('retains evidence when only a non-completed payment matches', async () => {
    const rpc = reviewRpc();
    const stalledPayment = { ...firstPayment, id: 'pay-stalled' };
    const from = vi
      .fn()
      .mockReturnValueOnce(selectQuery([]))
      .mockReturnValueOnce(selectQuery([stalledPayment]))
      .mockReturnValueOnce(selectQuery([order]));
    const supabase = { from, rpc } as unknown as SupabaseClient;

    await recoverUnknownPaystackRefund(supabase, 202, 'PSK-1');

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      'file_paystack_refund_recovery_review_v1',
      expect.objectContaining({
        p_order_id: 'order-1',
        p_paystack_ref: null,
        p_reason: expect.stringContaining('non-completed local payment'),
        p_metadata: expect.objectContaining({
          provider_refund_id: 202,
          provider_payment_transaction_id: 555,
          audit_record_failed: true,
        }),
        p_candidates: [
          expect.objectContaining({ payment_transaction_id: 'pay-stalled' }),
        ],
      })
    );
    expect(mocks.reconcilePaystackCancellationRefund).not.toHaveBeenCalled();
  });

  it('acknowledges the event when no local payment matches at all', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(selectQuery([]))
      .mockReturnValueOnce(selectQuery([]));
    const supabase = { from } as unknown as SupabaseClient;

    await recoverUnknownPaystackRefund(supabase, 202, 'PSK-1');

    expect(from).toHaveBeenCalledTimes(2);
  });

  it('throws when the recovery review cannot be persisted', async () => {
    const auditInsert = vi.fn().mockResolvedValue({ error: { code: '23505' } });
    const rpc = reviewRpc({ code: 'XX000' });
    const from = vi
      .fn()
      .mockReturnValueOnce(selectQuery([firstPayment]))
      .mockReturnValueOnce(selectQuery(order))
      .mockReturnValueOnce({ insert: auditInsert })
      .mockReturnValueOnce(selectQuery(null));
    const supabase = { from, rpc } as unknown as SupabaseClient;

    await expect(
      recoverUnknownPaystackRefund(supabase, 202, 'PSK-1')
    ).rejects.toThrow('refund_recovery_review_failed');
  });
});
