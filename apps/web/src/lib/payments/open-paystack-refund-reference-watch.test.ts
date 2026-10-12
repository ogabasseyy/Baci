import { describe, expect, it, vi } from 'vitest';
import { openPaystackRefundReferenceWatch } from './open-paystack-refund-reference-watch';

describe('openPaystackRefundReferenceWatch', () => {
  const args = { providerRefundStatus: 'processed', reference: 'BAC-REF' };

  it('opens the watch and returns the completed matches', async () => {
    const matches = [{ id: 'payment-1' }];
    const rpc = vi.fn().mockResolvedValue({ data: matches, error: null });

    await expect(
      openPaystackRefundReferenceWatch({ rpc } as never, args)
    ).resolves.toEqual(matches);
    expect(rpc).toHaveBeenCalledWith(
      'open_paystack_refund_reference_watch_v1',
      {
        p_evidence: {
          provider_refund_status: 'processed',
          reference_only: true,
        },
        p_paystack_ref: 'BAC-REF',
      }
    );
  });

  it('returns an empty handoff when no payment has landed yet', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });

    await expect(
      openPaystackRefundReferenceWatch({ rpc } as never, args)
    ).resolves.toEqual([]);
  });

  it('throws the lookup failure for redelivery', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: {} });

    await expect(
      openPaystackRefundReferenceWatch({ rpc } as never, args)
    ).rejects.toThrow('refund_event_payment_lookup_failed');
  });
});
