import { describe, expect, it, vi } from 'vitest';
import { openPaystackRefundRecoveryWatch } from './open-paystack-refund-recovery-watch';
import { resolvePaystackRefundRecoveryWatch } from './resolve-paystack-refund-recovery-watch';

const matches = [
  {
    amount: 100,
    gateway_reference: 'PSK-1',
    id: 'pay-1',
    merchant_id: 'merchant-1',
    order_id: 'order-1',
  },
];

describe('paystack refund recovery watch', () => {
  it('opens the watch and returns the confirming scan rows', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: matches, error: null });

    const result = await openPaystackRefundRecoveryWatch({ rpc } as never, {
      evidence: {
        amount_minor: 10000,
        currency: 'NGN',
        provider_payment_transaction_id: 555,
        provider_refund_status: 'processed',
      },
      providerRefundId: 202,
      reference: 'PSK-1',
    });

    expect(rpc).toHaveBeenCalledWith('open_paystack_refund_recovery_watch_v1', {
      p_evidence: {
        amount_minor: 10000,
        currency: 'NGN',
        provider_payment_transaction_id: 555,
        provider_refund_status: 'processed',
      },
      p_paystack_ref: 'PSK-1',
      p_provider_refund_id: 202,
    });
    expect(result).toEqual(matches);
  });

  it('throws the scan lookup error when opening fails', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: 'ECONNRESET' } });

    await expect(
      openPaystackRefundRecoveryWatch({ rpc } as never, {
        evidence: {
          amount_minor: 10000,
          currency: 'NGN',
          provider_payment_transaction_id: 555,
          provider_refund_status: 'processed',
        },
        providerRefundId: 202,
        reference: 'PSK-1',
      })
    ).rejects.toThrow('refund_event_payment_lookup_failed');
  });

  it('resolves the watch once the refund is handled', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });

    await resolvePaystackRefundRecoveryWatch({ rpc } as never, {
      providerRefundId: 202,
      reference: 'PSK-1',
    });

    expect(rpc).toHaveBeenCalledWith(
      'resolve_paystack_refund_recovery_watch_v1',
      { p_paystack_ref: 'PSK-1', p_provider_refund_id: 202 }
    );
  });

  it('throws for redelivery when the resolve fails', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: 'ECONNRESET' } });

    await expect(
      resolvePaystackRefundRecoveryWatch({ rpc } as never, {
        providerRefundId: 202,
        reference: 'PSK-1',
      })
    ).rejects.toThrow('refund_recovery_watch_resolve_failed');
  });
});
