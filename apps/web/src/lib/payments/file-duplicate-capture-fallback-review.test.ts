import { describe, expect, it, vi } from 'vitest';
import { fileDuplicateCaptureFallbackReview } from './file-duplicate-capture-fallback-review';

const attempt = {
  gateway_reference: 'PSK-1',
  id: 'attempt-1',
  merchant_id: 'merchant-1',
  order_id: 'order-1',
};

const evidence = {
  gateway: 'paystack',
  providerAmount: 5829060,
  providerCurrency: 'NGN',
  providerReference: '123456789',
  providerStatus: 'success',
};

function ownReviewQuery(existing: unknown) {
  return {
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: existing, error: null }),
    select: vi.fn().mockReturnThis(),
  };
}

describe('fileDuplicateCaptureFallbackReview', () => {
  it('returns true when our own open review already holds the evidence', async () => {
    const insert = vi.fn();
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(ownReviewQuery({ id: 'review-1' }))
      .mockReturnValue({ insert });

    const filed = await fileDuplicateCaptureFallbackReview({
      attempt,
      evidence,
      supabase: { from, rpc } as never,
    });

    expect(filed).toBe(true);
    expect(insert).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      'set_duplicate_capture_review_pending_v1',
      expect.objectContaining({
        p_pending: false,
        p_transaction_id: 'attempt-1',
      })
    );
  });

  it('inserts the full evidence row when no review exists', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(ownReviewQuery(null))
      .mockReturnValueOnce({ insert });

    const filed = await fileDuplicateCaptureFallbackReview({
      attempt,
      evidence,
      supabase: { from, rpc } as never,
    });

    expect(filed).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      'set_duplicate_capture_review_pending_v1',
      expect.objectContaining({ p_pending: false })
    );
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'duplicate_payment_capture_requires_review',
        order_id: 'order-1',
        txn_id: 'attempt-1',
        paystack_ref: 'PSK-1',
        metadata: expect.objectContaining({
          payment_transaction_id: 'attempt-1',
          provider_reference: '123456789',
        }),
      })
    );
  });

  it('files without the ref when another order owns the slot', async () => {
    const insert = vi
      .fn()
      .mockResolvedValueOnce({ error: { code: '23505' } })
      .mockResolvedValueOnce({ error: null });
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: false, error: null })
      .mockResolvedValue({ data: true, error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(ownReviewQuery(null))
      .mockReturnValue({ insert });

    const filed = await fileDuplicateCaptureFallbackReview({
      attempt,
      evidence,
      supabase: { from, rpc } as never,
    });

    expect(filed).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      'set_duplicate_capture_review_pending_v1',
      expect.objectContaining({ p_pending: false })
    );
    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        paystack_ref: null,
        txn_id: 'attempt-1',
      })
    );
  });

  it('merges into the open order review on conflict instead of a second insert', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: '23505' } });
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(ownReviewQuery(null))
      .mockReturnValue({ insert });

    const filed = await fileDuplicateCaptureFallbackReview({
      attempt,
      evidence,
      supabase: { from, rpc } as never,
    });

    // Retrying the insert with only paystack_ref cleared would hit the
    // same open-by-order index again and lose the evidence; the merge
    // records this capture on the already-open review instead.
    expect(filed).toBe(true);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith(
      'set_duplicate_capture_review_pending_v1',
      expect.objectContaining({ p_pending: false })
    );
    expect(rpc).toHaveBeenCalledWith(
      'merge_duplicate_payment_capture_evidence_v1',
      expect.objectContaining({
        p_order_id: 'order-1',
        p_merchant_id: 'merchant-1',
        p_transaction_id: 'attempt-1',
        p_gateway_reference: 'PSK-1',
        p_gateway: 'paystack',
        p_charge_id: '123456789',
        p_provider_amount: 5829060,
        p_provider_currency: 'NGN',
        p_provider_status: 'success',
      })
    );
  });

  it('falls back to the ref-less insert when no open review exists to merge into', async () => {
    const insert = vi
      .fn()
      .mockResolvedValueOnce({ error: { code: '23505' } })
      .mockResolvedValueOnce({ error: null });
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(ownReviewQuery(null))
      .mockReturnValue({ insert });

    const filed = await fileDuplicateCaptureFallbackReview({
      attempt,
      evidence,
      supabase: { from, rpc } as never,
    });

    // A definitive merge false means the conflict is another order's
    // ref slot, not this order's review: no pointless merge retry,
    // straight to the ref-less insert.
    expect(filed).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith(
      'set_duplicate_capture_review_pending_v1',
      expect.objectContaining({ p_pending: false })
    );
    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ paystack_ref: null })
    );
  });

  it('retries the merge once on transient failure before the ref-less insert', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: '23505' } });
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { code: 'XX000' } })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValue({ data: true, error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(ownReviewQuery(null))
      .mockReturnValue({ insert });

    const filed = await fileDuplicateCaptureFallbackReview({
      attempt,
      evidence,
      supabase: { from, rpc } as never,
    });

    expect(filed).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc).toHaveBeenCalledWith(
      'set_duplicate_capture_review_pending_v1',
      expect.objectContaining({ p_pending: false })
    );
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('returns false when the evidence cannot be persisted', async () => {
    const insert = vi.fn().mockResolvedValue({ error: new Error('db down') });
    const from = vi
      .fn()
      .mockReturnValueOnce(ownReviewQuery(null))
      .mockReturnValue({ insert });

    const filed = await fileDuplicateCaptureFallbackReview({
      attempt,
      evidence,
      supabase: { from } as never,
    });

    expect(filed).toBe(false);
  });
});
