import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { filePaystackRefundRecoveryReview } from './file-paystack-refund-recovery-review';

const review = {
  candidates: [
    {
      payment_transaction_id: 'pay-1',
      order_id: 'order-1',
      amount: 100,
      gateway_reference: 'PSK-1',
    },
  ],
  merchantId: 'merchant-1',
  metadata: {
    provider_refund_id: 202,
    provider_payment_transaction_id: 555,
    payment_transaction_id: 'pay-1',
    audit_record_failed: true,
  },
  orderId: 'order-1',
  paystackRef: '202',
  reason: 'Paystack refund 202 collides with a non-refund transaction',
};

describe('filePaystackRefundRecoveryReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('files the review through the atomic merge RPC with nested evidence', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'review-1', error: null });
    const supabase = { rpc } as unknown as SupabaseClient;

    await filePaystackRefundRecoveryReview(supabase, review);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      'file_paystack_refund_recovery_review_v1',
      expect.objectContaining({
        p_order_id: 'order-1',
        p_merchant_id: 'merchant-1',
        p_paystack_ref: '202',
        p_candidates: review.candidates,
        p_metadata: expect.objectContaining({
          provider_refund_id: 202,
          audit_record_failed: true,
          refund_evidence: {
            'provider:202': expect.objectContaining({
              audit_record_failed: true,
              payment_transaction_id: 'pay-1',
            }),
          },
        }),
      })
    );
  });

  it('throws when the RPC itself fails', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: 'XX000' } });
    const supabase = { rpc } as unknown as SupabaseClient;

    await expect(
      filePaystackRefundRecoveryReview(supabase, review)
    ).rejects.toThrow('refund_recovery_review_failed');
  });

  it('throws when the RPC rejects the input without a row', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const supabase = { rpc } as unknown as SupabaseClient;

    await expect(
      filePaystackRefundRecoveryReview(supabase, review)
    ).rejects.toThrow('refund_recovery_review_failed');
  });
});
