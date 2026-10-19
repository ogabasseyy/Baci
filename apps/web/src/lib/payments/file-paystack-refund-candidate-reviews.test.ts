import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { filePaystackRefundCandidateReviews } from './file-paystack-refund-candidate-reviews';

const filed = vi.hoisted(() => vi.fn());
vi.mock('./file-paystack-refund-recovery-review', () => ({
  filePaystackRefundRecoveryReview: filed,
}));

const evidence = {
  providerPaymentTransactionId: 555,
  providerRefundId: 202,
  providerRefundStatus: 'failed',
  reference: 'PSK-1',
};

describe('filePaystackRefundCandidateReviews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('files one review per candidate order with the shared candidate list', async () => {
    const supabase = {} as SupabaseClient;
    const candidates = [
      {
        amount: 100,
        gateway_reference: 'PSK-1',
        id: 'pay-1',
        merchant_id: 'merchant-1',
        order_id: 'order-1',
      },
      {
        amount: 100,
        gateway_reference: 'PSK-1',
        id: 'pay-2',
        merchant_id: 'merchant-2',
        order_id: 'order-2',
      },
    ];

    await filePaystackRefundCandidateReviews(
      supabase,
      candidates,
      evidence,
      'reason'
    );

    expect(filed).toHaveBeenCalledTimes(2);
    expect(filed).toHaveBeenNthCalledWith(
      1,
      supabase,
      expect.objectContaining({
        orderId: 'order-1',
        merchantId: 'merchant-1',
        paystackRef: null,
        providerRefundStatus: 'failed',
        reason: 'reason',
        metadata: expect.objectContaining({
          provider_refund_id: 202,
          provider_payment_transaction_id: 555,
          reference: 'PSK-1',
          audit_record_failed: true,
        }),
        candidates: [
          expect.objectContaining({ payment_transaction_id: 'pay-1' }),
          expect.objectContaining({ payment_transaction_id: 'pay-2' }),
        ],
      })
    );
    expect(filed).toHaveBeenNthCalledWith(
      2,
      supabase,
      expect.objectContaining({ orderId: 'order-2' })
    );
  });

  it('skips candidates without an attributable order', async () => {
    const supabase = {} as SupabaseClient;

    await filePaystackRefundCandidateReviews(
      supabase,
      [
        {
          amount: 100,
          gateway_reference: 'PSK-1',
          id: 'pay-9',
          merchant_id: 'merchant-9',
          order_id: null,
        },
      ],
      evidence,
      'reason'
    );

    expect(filed).not.toHaveBeenCalled();
  });
});
