import { describe, expect, it, vi } from 'vitest';
import { refundVtuToCustomerWallet } from './vtu-fulfillment-refund';

const ROW = {
  amount: 1000,
  biller_name: null,
  customer_id: 'customer-1',
  id: 'vtu-tx-1',
  merchant_id: 'merchant-1',
  network_provider: 'mtn',
  type: 'airtime',
};

function createSupabase(
  ledgerData: { amount: number } | null = null,
  reversalLedgerData: { amount: number } | null = null
) {
  const filters = new Map<string, unknown>();
  const maybeSingle = vi.fn(() => {
    // Route card-leg vs reversal-leg lookups by their source_type
    // filter so partial-refund states can be modeled.
    if (filters.get('source_type') === 'vtu_wallet_reversal') {
      return Promise.resolve({ data: reversalLedgerData, error: null });
    }
    return Promise.resolve({ data: ledgerData, error: null });
  });
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn((field: string, value: unknown) => {
    filters.set(field, value);
    return chain;
  });
  chain.order = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.maybeSingle = maybeSingle;
  const from = vi.fn(() => chain);
  const rpc = vi.fn(() => Promise.resolve({ data: null, error: null }));
  return { from, rpc, supabase: { from, rpc } as never };
}

describe('refundVtuToCustomerWallet gates', () => {
  it.each([
    ['missing customer', { ...ROW, customer_id: null }],
    ['zero amount', { ...ROW, amount: 0 }],
    ['non-checkout source', { ...ROW, source: 'direct' }],
  ])('returns zeros for %s without touching the database', async (_, row) => {
    const { from, rpc, supabase } = createSupabase();

    const result = await refundVtuToCustomerWallet({
      metadata: {},
      row: row as never,
      supabase,
    });

    expect(result).toEqual({
      metadataChanged: false,
      refundIssued: false,
      refundedAmount: 0,
    });
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('reconstructs the hybrid total on an already-issued cached replay', async () => {
    const { from, rpc, supabase } = createSupabase();

    const result = await refundVtuToCustomerWallet({
      metadata: {
        paymentSplit: { card: 400, wallet: 600 },
        refundAmount: 400,
        refundContext: 'hybrid_vend_failure',
        refundIssued: true,
      },
      row: { ...ROW, source: 'checkout' } as never,
      supabase,
    });

    expect(result).toEqual({
      metadataChanged: false,
      refundIssued: true,
      refundedAmount: 1000,
    });
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns the persisted amount for already-issued non-hybrid replays', async () => {
    const { supabase } = createSupabase();

    const result = await refundVtuToCustomerWallet({
      metadata: {
        refundAmount: 250,
        refundContext: 'card_only',
        refundIssued: true,
      },
      row: { ...ROW, source: 'checkout' } as never,
      supabase,
    });

    expect(result.refundedAmount).toBe(250);
  });

  it('falls back to the row total for legacy issued rows without a persisted amount', async () => {
    const { supabase } = createSupabase();

    const result = await refundVtuToCustomerWallet({
      metadata: { refundIssued: true },
      row: { ...ROW, source: 'checkout' } as never,
      supabase,
    });

    expect(result.refundedAmount).toBe(1000);
  });
});

describe('refundVtuToCustomerWallet invariant', () => {
  it('throws fail-closed on split-without-debit with no ledger row', async () => {
    const { supabase } = createSupabase(null);

    await expect(
      refundVtuToCustomerWallet({
        metadata: {
          paymentSplit: { card: 400, wallet: 600 },
          walletDebited: false,
        },
        row: { ...ROW, source: 'checkout' } as never,
        supabase,
      })
    ).rejects.toThrow(/invariant violated/);
  });

  it('syncs metadata from the ledger when a race refund already landed', async () => {
    const { supabase } = createSupabase({ amount: 400 });
    const metadata: Record<string, unknown> = {
      paymentSplit: { card: 400, wallet: 600 },
      walletDebited: false,
    };

    const result = await refundVtuToCustomerWallet({
      metadata,
      row: { ...ROW, source: 'checkout' } as never,
      supabase,
    });

    expect(result).toEqual({
      metadataChanged: true,
      refundIssued: true,
      refundedAmount: 400,
    });
    expect(metadata.refundContext).toBe('wallet_race');
  });

  it('completes the card leg when only the reversal leg is in the ledger', async () => {
    // A hybrid refund restored the wallet leg then died before the
    // card leg (R117 P1): throwing here would strand the card
    // portion while the retry path reports the row refunded. The
    // race arm completes the card leg instead.
    const { rpc, supabase } = createSupabase(null, { amount: 600 });
    const metadata: Record<string, unknown> = {
      paymentSplit: { card: 400, wallet: 600 },
      walletDebited: false,
    };

    const result = await refundVtuToCustomerWallet({
      metadata,
      row: { ...ROW, source: 'checkout' } as never,
      supabase,
    });

    expect(result).toEqual({
      metadataChanged: true,
      refundIssued: true,
      refundedAmount: 400,
    });
    expect(rpc).toHaveBeenCalledWith(
      'refund_customer_wallet_for_vtu',
      expect.objectContaining({ p_amount: 400 })
    );
    expect(rpc).not.toHaveBeenCalledWith(
      'reverse_vtu_wallet_payment',
      expect.anything()
    );
  });
});
