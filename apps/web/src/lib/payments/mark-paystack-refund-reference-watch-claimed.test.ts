import { describe, expect, it, vi } from 'vitest';
import { markPaystackRefundReferenceWatchClaimed } from './mark-paystack-refund-reference-watch-claimed';

describe('markPaystackRefundReferenceWatchClaimed', () => {
  it('retains the watch for future completions once the evidence is handled', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });

    await markPaystackRefundReferenceWatchClaimed({ rpc } as never, {
      reference: 'PSK-1',
    });

    expect(rpc).toHaveBeenCalledWith(
      'mark_paystack_refund_reference_watch_claimed_v1',
      { p_paystack_ref: 'PSK-1' }
    );
  });

  it('throws for redelivery when the claim fails', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: 'ECONNRESET' } });

    await expect(
      markPaystackRefundReferenceWatchClaimed({ rpc } as never, {
        reference: 'PSK-1',
      })
    ).rejects.toThrow('refund_recovery_watch_claim_failed');
  });
});
