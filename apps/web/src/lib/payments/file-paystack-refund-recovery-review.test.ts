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

function updateQuery(data: unknown, error: unknown = null) {
  const chain = {
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    select: vi.fn().mockResolvedValue({ data, error }),
  };
  return { update: vi.fn().mockReturnValue(chain) };
}

describe('filePaystackRefundRecoveryReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts the review with nested per-refund evidence on first filing', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ insert });
    const supabase = { from } as unknown as SupabaseClient;

    await filePaystackRefundRecoveryReview(supabase, review);

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'order_cancellation_refund_requires_review',
        order_id: 'order-1',
        merchant_id: 'merchant-1',
        paystack_ref: '202',
        metadata: expect.objectContaining({
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

  it('merges new evidence into the open review instead of dropping it', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: '23505' } });
    const open = {
      id: 'review-1',
      metadata: {
        provider_refund_id: 201,
        refund_evidence: {
          'provider:201': { audit_record_failed: true },
        },
      },
      candidates: [{ payment_transaction_id: 'pay-0' }],
    };
    const select = vi.fn().mockReturnThis();
    const update = updateQuery([{ id: 'review-1' }]);
    const from = vi
      .fn()
      .mockReturnValueOnce({ insert })
      .mockReturnValueOnce({
        select,
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [open], error: null }),
      })
      .mockReturnValueOnce(update);
    const supabase = { from } as unknown as SupabaseClient;

    await filePaystackRefundRecoveryReview(supabase, review);

    expect(update.update).toHaveBeenCalledWith({
      metadata: expect.objectContaining({
        provider_refund_id: 201,
        refund_evidence: expect.objectContaining({
          'provider:201': { audit_record_failed: true },
          'provider:202': expect.objectContaining({
            audit_record_failed: true,
            payment_transaction_id: 'pay-1',
          }),
        }),
      }),
      candidates: [
        { payment_transaction_id: 'pay-0' },
        expect.objectContaining({ payment_transaction_id: 'pay-1' }),
      ],
    });
  });

  it('deduplicates candidates already present in the open review', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: '23505' } });
    const open = {
      id: 'review-1',
      metadata: {},
      candidates: [{ payment_transaction_id: 'pay-1' }],
    };
    const update = updateQuery([{ id: 'review-1' }]);
    const from = vi
      .fn()
      .mockReturnValueOnce({ insert })
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [open], error: null }),
      })
      .mockReturnValueOnce(update);
    const supabase = { from } as unknown as SupabaseClient;

    await filePaystackRefundRecoveryReview(supabase, review);

    expect(update.update).toHaveBeenCalledWith(
      expect.objectContaining({
        candidates: [{ payment_transaction_id: 'pay-1' }],
      })
    );
  });

  it('refires a recurrence when no open review remains', async () => {
    const insert = vi
      .fn()
      .mockResolvedValueOnce({ error: { code: '23505' } })
      .mockResolvedValueOnce({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce({ insert })
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      })
      .mockReturnValueOnce({ insert });
    const supabase = { from } as unknown as SupabaseClient;

    await filePaystackRefundRecoveryReview(supabase, review);

    expect(insert).toHaveBeenCalledTimes(2);
  });

  it('throws when persistence itself fails', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: 'XX000' } });
    const from = vi.fn().mockReturnValue({ insert });
    const supabase = { from } as unknown as SupabaseClient;

    await expect(
      filePaystackRefundRecoveryReview(supabase, review)
    ).rejects.toThrow('refund_recovery_review_failed');
  });
});
