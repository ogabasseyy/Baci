import { describe, expect, it, vi } from 'vitest';
import { holdPaystackRefundForReview } from './hold-paystack-refund-for-review';

describe('holdPaystackRefundForReview', () => {
  it('stamps the hold through the atomic RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });

    await expect(
      holdPaystackRefundForReview({ rpc } as never, 'refund-1', 'mismatch')
    ).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith(
      'hold_paystack_cancellation_refund_for_review_v1',
      { p_refund_id: 'refund-1', p_reason: 'mismatch' }
    );
  });

  it('throws when the hold RPC errors', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: {} });

    await expect(
      holdPaystackRefundForReview({ rpc } as never, 'refund-1', 'mismatch')
    ).rejects.toThrow('refund_review_hold_failed');
  });

  it('throws when the hold RPC reports no row held', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });

    await expect(
      holdPaystackRefundForReview({ rpc } as never, 'refund-1', 'mismatch')
    ).rejects.toThrow('refund_review_hold_failed');
  });
});
