import { describe, expect, it, vi } from 'vitest';
import { stampVerifiedManualPaystackRefunds } from './stamp-verified-manual-paystack-refunds';

const linkedPaymentId = (row: { metadata: unknown }): string | null => {
  const claimed = (row.metadata as { payment_transaction_id?: unknown } | null)
    ?.payment_transaction_id;
  return typeof claimed === 'string' ? claimed : null;
};

function supabase(error: unknown = null, data: unknown = [{ id: 'refund-1' }]) {
  const select = vi.fn().mockResolvedValue({ data, error });
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.select = select;
  const update = vi.fn().mockReturnValue(chain);
  return {
    chain,
    from: vi.fn().mockReturnValue({ update }),
    select,
    update,
  };
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
      pairedProviderRefunds: [
        { kobo: 100, providerRefundId: '7' },
        { kobo: 100, providerRefundId: '8' },
      ],
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
        provider_refund_id: '7',
      },
      // Status renames its current value so the sync trigger
      // re-evaluates coverage; metadata alone would not fire it.
      status: 'completed',
    });
    expect(client.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'refunded' })
    );
    expect(client.chain.eq).toHaveBeenCalledWith('id', 'refund-1');
    expect(client.chain.eq).toHaveBeenCalledWith('id', 'refund-2');
    // The stale snapshot is guarded: a concurrent verdict between the
    // preflight read and the stamp must zero-row instead of being
    // overwritten back to processed.
    expect(client.chain.eq).toHaveBeenCalledWith('status', 'completed');
    expect(client.chain.is).toHaveBeenCalledWith(
      'metadata->>provider_refund_status',
      null
    );
    expect(client.select).toHaveBeenCalledWith('id');
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
        { kobo: 40, providerRefundId: '8' },
        { kobo: 60, providerRefundId: '7' },
      ],
      refundRows: [
        row({ amount: 0.6 }),
        row({ amount: 0.4, id: 'refund-2', status: 'refunded' }),
        // Foreign-currency rows never pair and take no stamp.
        row({ currency: 'USD', id: 'refund-3' }),
      ],
      supabase: client as never,
      transactionId: 'payment-1',
    });
    expect(client.update).toHaveBeenCalledTimes(2);
    expect(client.update.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({ provider_refund_id: '7' }),
      })
    );
    expect(client.update.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({ provider_refund_id: '8' }),
      })
    );
  });

  it('skips rows that consumed no provider pair instead of stamping them', async () => {
    // The foreign-currency row never pairs: stamping it processed
    // would assert verification no refund was consumed for, and
    // downstream coverage counts the stamp as verified. Skipped
    // rows stay unverified so the matcher withholds them.
    const client = supabase();
    await stampVerifiedManualPaystackRefunds({
      currency: 'NGN',
      linkedPaymentId,
      pairedProviderRefunds: [{ kobo: 100, providerRefundId: '7' }],
      refundRows: [row({ currency: 'USD', id: 'refund-3' })],
      supabase: client as never,
      transactionId: 'payment-1',
    });
    expect(client.update).not.toHaveBeenCalled();
  });

  it('throws when the stamp write fails', async () => {
    const client = supabase(new Error('write failed'));
    await expect(
      stampVerifiedManualPaystackRefunds({
        currency: 'NGN',
        linkedPaymentId,
        pairedProviderRefunds: [{ kobo: 100, providerRefundId: '7' }],
        refundRows: [row()],
        supabase: client as never,
        transactionId: 'payment-1',
      })
    ).rejects.toThrow('verified_manual_paystack_stamp_failed');
  });

  it('throws when a concurrent verdict lands between preflight read and stamp', async () => {
    // The guard matches nothing after the concurrent write: zero rows
    // fail loud so the retry re-verifies instead of stamping over the
    // verdict the other worker just persisted.
    const client = supabase(null, []);
    await expect(
      stampVerifiedManualPaystackRefunds({
        currency: 'NGN',
        linkedPaymentId,
        pairedProviderRefunds: [{ kobo: 100, providerRefundId: '7' }],
        refundRows: [row()],
        supabase: client as never,
        transactionId: 'payment-1',
      })
    ).rejects.toThrow('verified_manual_paystack_stamp_failed');
  });
});
