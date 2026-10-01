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
    const from = vi
      .fn()
      .mockReturnValueOnce(ownReviewQuery({ id: 'review-1' }))
      .mockReturnValue({ insert });

    const filed = await fileDuplicateCaptureFallbackReview({
      attempt,
      evidence,
      supabase: { from } as never,
    });

    expect(filed).toBe(true);
    expect(insert).not.toHaveBeenCalled();
  });

  it('inserts the full evidence row when no review exists', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(ownReviewQuery(null))
      .mockReturnValueOnce({ insert });

    const filed = await fileDuplicateCaptureFallbackReview({
      attempt,
      evidence,
      supabase: { from } as never,
    });

    expect(filed).toBe(true);
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
    const from = vi
      .fn()
      .mockReturnValueOnce(ownReviewQuery(null))
      .mockReturnValue({ insert });

    const filed = await fileDuplicateCaptureFallbackReview({
      attempt,
      evidence,
      supabase: { from } as never,
    });

    expect(filed).toBe(true);
    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        paystack_ref: null,
        txn_id: 'attempt-1',
      })
    );
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
