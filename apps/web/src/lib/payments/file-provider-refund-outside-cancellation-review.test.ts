import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fileActiveOrderPaystackRefundCandidateReviews,
  fileProviderRefundOutsideCancellationReview,
} from './file-provider-refund-outside-cancellation-review';

function review(overrides = {}) {
  return {
    amount: 100,
    currency: 'NGN',
    merchantId: 'merchant-1',
    orderId: 'order-1',
    orderNumber: 'ORD-1',
    paymentId: 'pay-1',
    paymentReference: 'PSK-1',
    providerPaymentTransactionId: 555,
    providerRefundId: 202,
    providerRefundStatus: 'processed',
    ...overrides,
  };
}

function candidate(id: string, orderId: string | null, merchantId: string) {
  return {
    amount: 100,
    gateway_reference: 'PSK-1',
    id,
    merchant_id: merchantId,
    order_id: orderId,
  };
}

function ordersQuery(data: unknown, error: unknown = null) {
  return {
    in: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are thenable.
    then: (resolve: (value: unknown) => void) => resolve({ data, error }),
  };
}

describe('fileProviderRefundOutsideCancellationReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts a review with provider-keyed evidence on first filing', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const supabase = {
      from: vi.fn().mockReturnValue({ insert }),
      rpc: vi.fn(),
    } as unknown as SupabaseClient;

    await fileProviderRefundOutsideCancellationReview(supabase, review());

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'provider_refund_outside_cancellation',
        order_id: 'order-1',
        merchant_id: 'merchant-1',
        paystack_ref: null,
        metadata: expect.objectContaining({
          provider_refund_id: 202,
          refund_evidence: expect.objectContaining({
            'provider:202': expect.objectContaining({
              payment_transaction_id: 'pay-1',
              provider_refund_status: 'processed',
            }),
          }),
        }),
      })
    );
  });

  it('merges evidence into the open review on redelivery conflict', async () => {
    const insert = vi
      .fn()
      .mockResolvedValue({ error: { code: '23505', message: 'duplicate' } });
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const supabase = {
      from: vi.fn().mockReturnValue({ insert }),
      rpc,
    } as unknown as SupabaseClient;

    await fileProviderRefundOutsideCancellationReview(supabase, review());

    expect(rpc).toHaveBeenCalledWith(
      'merge_provider_refund_outside_cancellation_evidence_v1',
      expect.objectContaining({
        p_order_id: 'order-1',
        p_merchant_id: 'merchant-1',
        p_evidence_key: 'provider:202',
        p_evidence: expect.objectContaining({
          payment_transaction_id: 'pay-1',
        }),
      })
    );
  });

  it('throws on non-conflict write failures and failed merges', async () => {
    const failingInsert = vi
      .fn()
      .mockResolvedValue({ error: { code: '42501', message: 'denied' } });
    const supabase = {
      from: vi.fn().mockReturnValue({ insert: failingInsert }),
      rpc: vi.fn(),
    } as unknown as SupabaseClient;

    await expect(
      fileProviderRefundOutsideCancellationReview(supabase, review())
    ).rejects.toThrow('active_order_refund_review_failed');

    const conflictInsert = vi
      .fn()
      .mockResolvedValue({ error: { code: '23505', message: 'duplicate' } });
    const failedMerge = {
      from: vi.fn().mockReturnValue({ insert: conflictInsert }),
      rpc: vi.fn().mockResolvedValue({ data: false, error: null }),
    } as unknown as SupabaseClient;

    await expect(
      fileProviderRefundOutsideCancellationReview(failedMerge, review())
    ).rejects.toThrow('active_order_refund_review_failed');
  });
});

describe('fileActiveOrderPaystackRefundCandidateReviews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const evidence = {
    providerPaymentTransactionId: 555,
    providerRefundId: 202,
    reference: 'PSK-1',
  };
  const refund = { amount: 100, currency: 'NGN', status: 'processed' };

  it('groups same-order candidates into one review and skips cancelled orders', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(
        ordersQuery([
          {
            cancelled_at: null,
            id: 'order-9',
            order_number: 'ORD-9',
            shipping_status: 'processing',
          },
          {
            cancelled_at: '2026-09-27T00:00:00Z',
            id: 'order-1',
            order_number: 'ORD-1',
            shipping_status: 'cancelled',
          },
        ])
      )
      .mockReturnValue({ insert });
    const supabase = { from, rpc: vi.fn() } as unknown as SupabaseClient;

    await fileActiveOrderPaystackRefundCandidateReviews(
      supabase,
      [
        candidate('pay-1', 'order-9', 'merchant-9'),
        candidate('pay-2', 'order-9', 'merchant-9'),
        candidate('pay-3', 'order-1', 'merchant-1'),
      ],
      evidence,
      'ambiguous refund',
      refund
    );

    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'provider_refund_outside_cancellation',
        order_id: 'order-9',
        candidates: [
          expect.objectContaining({ payment_transaction_id: 'pay-1' }),
          expect.objectContaining({ payment_transaction_id: 'pay-2' }),
        ],
      })
    );
  });

  it('files nothing when every candidate is cancelled', async () => {
    const insert = vi.fn();
    const from = vi
      .fn()
      .mockReturnValueOnce(
        ordersQuery([
          {
            cancelled_at: '2026-09-27T00:00:00Z',
            id: 'order-1',
            order_number: 'ORD-1',
            shipping_status: 'cancelled',
          },
        ])
      )
      .mockReturnValue({ insert });
    const supabase = { from, rpc: vi.fn() } as unknown as SupabaseClient;

    await fileActiveOrderPaystackRefundCandidateReviews(
      supabase,
      [candidate('pay-1', 'order-1', 'merchant-1')],
      evidence,
      'ambiguous refund',
      refund
    );

    expect(insert).not.toHaveBeenCalled();
  });

  it('throws when the order lookup fails', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(ordersQuery(null, new Error('db down')));
    const supabase = { from, rpc: vi.fn() } as unknown as SupabaseClient;

    await expect(
      fileActiveOrderPaystackRefundCandidateReviews(
        supabase,
        [candidate('pay-1', 'order-1', 'merchant-1')],
        evidence,
        'ambiguous refund',
        refund
      )
    ).rejects.toThrow('refund_event_order_lookup_failed');
  });
});
