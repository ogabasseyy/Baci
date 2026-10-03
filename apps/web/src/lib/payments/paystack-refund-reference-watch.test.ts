import { describe, expect, it, vi } from 'vitest';
import { openPaystackRefundReferenceWatch } from './open-paystack-refund-reference-watch';

const matches = [
  {
    amount: 100,
    gateway_reference: 'PSK-1',
    id: 'pay-1',
    merchant_id: 'merchant-1',
    order_id: 'order-1',
  },
];

describe('paystack refund reference watch', () => {
  it('opens the watch and returns the confirming scan rows', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: matches, error: null });

    const result = await openPaystackRefundReferenceWatch({ rpc } as never, {
      providerRefundStatus: 'processed',
      reference: 'PSK-1',
    });

    expect(rpc).toHaveBeenCalledWith(
      'open_paystack_refund_reference_watch_v1',
      {
        p_evidence: {
          provider_refund_status: 'processed',
          reference_only: true,
        },
        p_paystack_ref: 'PSK-1',
      }
    );
    expect(result).toEqual(matches);
  });

  it('throws the scan lookup error when opening fails', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: 'ECONNRESET' } });

    await expect(
      openPaystackRefundReferenceWatch({ rpc } as never, {
        providerRefundStatus: 'processed',
        reference: 'PSK-1',
      })
    ).rejects.toThrow('refund_event_payment_lookup_failed');
  });
});
