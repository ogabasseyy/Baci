import { describe, expect, it, vi } from 'vitest';
import { stampVerifiedManualPaystackRefunds } from './stamp-verified-manual-paystack-refunds';

const linkedPaymentId = (row: { metadata: unknown }): string | null => {
  const claimed = (row.metadata as { payment_transaction_id?: unknown } | null)
    ?.payment_transaction_id;
  return typeof claimed === 'string' ? claimed : null;
};

function supabase(error: unknown = null) {
  const eq = vi.fn().mockResolvedValue({ error });
  const update = vi.fn().mockReturnValue({ eq });
  return { eq, from: vi.fn().mockReturnValue({ update }), update };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    amount: 1,
    currency: 'NGN',
    gateway: 'manual',
    id: 'refund-1',
    metadata: {
      method: 'paystack',
      payment_transaction_id: 'payment-1',
    },
    status: 'completed',
    ...overrides,
  };
}

describe('stampVerifiedManualPaystackRefunds', () => {
  it('stamps the leg’s unverified manual Paystack rows', async () => {
    const client = supabase();
    await stampVerifiedManualPaystackRefunds({
      currency: 'NGN',
      linkedPaymentId,
      refundRows: [
        row(),
        row({ id: 'refund-2', status: 'refunded' }),
        // Already stamped: skipped so retries never refire the trigger.
        row({
          id: 'refund-3',
          metadata: {
            method: 'paystack',
            payment_transaction_id: 'payment-1',
            provider_refund_status: 'processed',
          },
        }),
        // Not a Paystack claim: never stamped.
        row({
          id: 'refund-4',
          metadata: {
            method: 'cash',
            payment_transaction_id: 'payment-1',
          },
        }),
        // Another leg's row: untouched.
        row({
          id: 'refund-5',
          metadata: {
            method: 'paystack',
            payment_transaction_id: 'payment-9',
          },
        }),
        // Non-terminal rows are not matcher evidence: untouched.
        row({ id: 'refund-6', status: 'pending' }),
      ],
      supabase: client as never,
      transactionId: 'payment-1',
    });
    expect(client.from).toHaveBeenCalledWith('transactions');
    expect(client.update).toHaveBeenCalledTimes(2);
    expect(client.update).toHaveBeenCalledWith({
      metadata: {
        method: 'paystack',
        payment_transaction_id: 'payment-1',
        provider_refund_status: 'processed',
      },
      // Status renames its current value so the sync trigger
      // re-evaluates coverage; metadata alone would not fire it.
      status: 'completed',
    });
    expect(client.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'refunded' })
    );
    expect(client.eq).toHaveBeenCalledWith('id', 'refund-1');
    expect(client.eq).toHaveBeenCalledWith('id', 'refund-2');
  });

  it('skips rows whose metadata carries no Paystack claim', async () => {
    const client = supabase();
    await stampVerifiedManualPaystackRefunds({
      currency: 'NGN',
      linkedPaymentId: () => 'payment-1',
      refundRows: [row({ id: 'refund-7', metadata: null })],
      supabase: client as never,
      transactionId: 'payment-1',
    });
    expect(client.update).not.toHaveBeenCalled();
  });

  it('persists the paired provider refund id per row', async () => {
    const client = supabase();
    await stampVerifiedManualPaystackRefunds({
      currency: 'NGN',
      linkedPaymentId,
      pairedProviderRefunds: [
        // Provider order need not match ledger order: the stamp
        // assigns by amount, so the 60 row takes id 7 even though
        // id 8 lists first.
        { kobo: 40, providerRefundId: 8 },
        { kobo: 60, providerRefundId: 7 },
      ],
      refundRows: [
        row({ amount: 0.6 }),
        row({ amount: 0.4, id: 'refund-2', status: 'refunded' }),
        // Foreign-currency rows never pair: no proof to steal.
        row({ currency: 'USD', id: 'refund-3' }),
      ],
      supabase: client as never,
      transactionId: 'payment-1',
    });
    expect(client.update).toHaveBeenCalledTimes(3);
    expect(client.update.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({ provider_refund_id: 7 }),
      })
    );
    expect(client.update.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({ provider_refund_id: 8 }),
      })
    );
    expect(client.update.mock.calls[2]?.[0]).toEqual(
      expect.objectContaining({
        metadata: expect.not.objectContaining({
          provider_refund_id: expect.anything(),
        }),
      })
    );
  });

  it('throws when the stamp write fails', async () => {
    const client = supabase(new Error('write failed'));
    await expect(
      stampVerifiedManualPaystackRefunds({
        currency: 'NGN',
        linkedPaymentId,
        refundRows: [row()],
        supabase: client as never,
        transactionId: 'payment-1',
      })
    ).rejects.toThrow('verified_manual_paystack_stamp_failed');
  });
});
