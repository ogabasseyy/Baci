import { describe, expect, it, vi } from 'vitest';
import { openPaystackRefundRecoveryWatch } from './open-paystack-refund-recovery-watch';

describe('openPaystackRefundRecoveryWatch', () => {
  const args = {
    evidence: {
      amount_minor: 5829060,
      currency: 'NGN',
      provider_payment_transaction_id: 123456789,
      provider_refund_status: 'processed',
    },
    providerRefundId: 987654321,
    reference: 'BAC-REF',
  };

  it('opens the watch and returns the completed matches', async () => {
    const matches = [{ id: 'payment-1' }];
    const rpc = vi.fn().mockResolvedValue({ data: matches, error: null });

    await expect(
      openPaystackRefundRecoveryWatch({ rpc } as never, args)
    ).resolves.toEqual(matches);
    expect(rpc).toHaveBeenCalledWith('open_paystack_refund_recovery_watch_v1', {
      p_evidence: args.evidence,
      p_paystack_ref: 'BAC-REF',
      p_provider_refund_id: 987654321,
    });
  });

  it('returns an empty handoff when no payment has landed yet', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });

    await expect(
      openPaystackRefundRecoveryWatch({ rpc } as never, args)
    ).resolves.toEqual([]);
  });

  it('throws the lookup failure for redelivery', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: {} });

    await expect(
      openPaystackRefundRecoveryWatch({ rpc } as never, args)
    ).rejects.toThrow('refund_event_payment_lookup_failed');
  });
});
