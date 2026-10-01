import { describe, expect, it, vi } from 'vitest';
import { resolvePaystackRefundReferenceWatch } from './resolve-paystack-refund-reference-watch';

describe('resolvePaystackRefundReferenceWatch', () => {
  it('resolves the watch for the refund reference', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });

    await expect(
      resolvePaystackRefundReferenceWatch({ rpc } as never, {
        reference: 'BAC-REF',
      })
    ).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith(
      'resolve_paystack_refund_reference_watch_v1',
      { p_paystack_ref: 'BAC-REF' }
    );
  });

  it('throws for redelivery instead of leaking the watch open', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: {} });

    await expect(
      resolvePaystackRefundReferenceWatch({ rpc } as never, {
        reference: 'BAC-REF',
      })
    ).rejects.toThrow('refund_recovery_watch_resolve_failed');
  });
});
