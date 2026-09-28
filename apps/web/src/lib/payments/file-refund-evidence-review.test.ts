import { describe, expect, it, vi } from 'vitest';
import { fileRefundEvidenceReview } from './file-refund-evidence-review';

const refund = {
  amount: 100,
  currency: 'NGN',
  gateway_reference: '42',
  id: 'refund-1',
  merchant_id: 'merchant-1',
  metadata: {},
  order_id: 'order-1',
  status: 'refund_pending',
};

describe('fileRefundEvidenceReview', () => {
  it('files the review with the mismatch reason', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const db = { from: vi.fn(() => ({ insert })) };

    await fileRefundEvidenceReview(db as never, refund, 'evidence_mismatch');

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'order_cancellation_refund_requires_review',
        reason: expect.stringContaining('evidence_mismatch'),
        txn_id: 'refund-1',
      })
    );
  });

  it('merges evidence when the review row already exists', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: '23505' } });
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const db = { from: vi.fn(() => ({ insert })), rpc };

    await fileRefundEvidenceReview(db as never, refund, 'evidence_mismatch');

    expect(rpc).toHaveBeenCalledWith(
      'merge_paystack_cancellation_refund_review_v1',
      expect.objectContaining({ p_refund_id: 'refund-1' })
    );
  });

  it('throws when the merge fails', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: '23505' } });
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    const db = { from: vi.fn(() => ({ insert })), rpc };

    await expect(
      fileRefundEvidenceReview(db as never, refund, 'evidence_mismatch')
    ).rejects.toThrow('refund_evidence_review_persistence_failed');
  });

  it('throws on non-conflict insert errors', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: '50000' } });
    const db = { from: vi.fn(() => ({ insert })) };

    await expect(
      fileRefundEvidenceReview(db as never, refund, 'evidence_mismatch')
    ).rejects.toThrow('refund_evidence_review_persistence_failed');
  });
});
