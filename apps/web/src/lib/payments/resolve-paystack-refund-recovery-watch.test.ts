import { describe, expect, it, vi } from 'vitest';
import { resolvePaystackRefundRecoveryWatch } from './resolve-paystack-refund-recovery-watch';

describe('resolvePaystackRefundRecoveryWatch', () => {
  it('resolves the watch for the refund reference', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });

    await expect(
      resolvePaystackRefundRecoveryWatch({ rpc } as never, {
        providerRefundId: 987654321,
        reference: 'BAC-REF',
      })
    ).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith(
      'resolve_paystack_refund_recovery_watch_v1',
      { p_paystack_ref: 'BAC-REF', p_provider_refund_id: 987654321 }
    );
  });

  it('throws for redelivery instead of leaking the watch open', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: {} });

    await expect(
      resolvePaystackRefundRecoveryWatch({ rpc } as never, {
        providerRefundId: 987654321,
        reference: 'BAC-REF',
      })
    ).rejects.toThrow('refund_recovery_watch_resolve_failed');
  });
});
