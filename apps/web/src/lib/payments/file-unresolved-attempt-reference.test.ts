import { describe, expect, it, vi } from 'vitest';
import { fileUnresolvedAttemptReference } from './file-unresolved-attempt-reference';

const attempt = {
  gateway_reference: 'BAC-OLD',
  id: 'attempt-1',
  merchant_id: 'merchant-1',
  order_id: 'order-1',
};

describe('fileUnresolvedAttemptReference', () => {
  it('inserts an unstamped review for an unverifiable reference', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const rpc = vi.fn();
    const from = vi.fn().mockReturnValue({ insert });

    const filed = await fileUnresolvedAttemptReference({
      attempt,
      reason: 'HTTP_404',
      supabase: { from, rpc } as never,
    });

    expect(filed).toBe(true);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'abandoned_attempt_evidence_mismatch',
        metadata: expect.objectContaining({ unresolved_reference: true }),
        paystack_ref: 'BAC-OLD',
        txn_id: 'attempt-1',
      })
    );
    // No stamp: the row must keep rotating for a late verify.
    expect(rpc).not.toHaveBeenCalled();
  });

  it('merges into the open review on a ref conflict', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: '23505' } });
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const from = vi.fn().mockReturnValue({ insert });

    const filed = await fileUnresolvedAttemptReference({
      attempt,
      reason: 'HTTP_404',
      supabase: { from, rpc } as never,
    });

    expect(filed).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      'merge_abandoned_attempt_evidence_mismatch_v1',
      expect.objectContaining({ p_transaction_id: 'attempt-1' })
    );
  });

  it('returns false when the evidence cannot be persisted', async () => {
    const insert = vi.fn().mockResolvedValue({ error: new Error('db down') });
    const from = vi.fn().mockReturnValue({ insert });

    const filed = await fileUnresolvedAttemptReference({
      attempt,
      reason: 'HTTP_404',
      supabase: { from } as never,
    });

    expect(filed).toBe(false);
  });
});
