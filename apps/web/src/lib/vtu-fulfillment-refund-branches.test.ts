import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyRefundMetadata,
  findExistingVtuRefundLedger,
  refundCardOnly,
  refundHybridKudaFailure,
  refundHybridWalletRace,
} from './vtu-fulfillment-refund-branches';

const ROW = {
  amount: 1000,
  biller_name: null,
  customer_id: 'customer-1',
  id: 'vtu-tx-1',
  merchant_id: 'merchant-1',
  network_provider: 'mtn',
  type: 'airtime',
};

function createSupabase({
  ledgerData = null,
  ledgerError = null,
  rpcError = null,
}: {
  ledgerData?: { amount: number } | null;
  ledgerError?: { message: string } | null;
  rpcError?: { message: string } | null;
} = {}) {
  const rpc = vi.fn(() => Promise.resolve({ data: null, error: rpcError }));
  const maybeSingle = vi.fn(() =>
    Promise.resolve({ data: ledgerData, error: ledgerError })
  );
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.maybeSingle = maybeSingle;
  const from = vi.fn(() => chain);
  return { from, maybeSingle, rpc, supabase: { from, rpc } as never };
}

describe('applyRefundMetadata', () => {
  it('stamps the four refund keys and reports a change', () => {
    const metadata: Record<string, unknown> = {};

    const changed = applyRefundMetadata(metadata, 400, 'card_only');

    expect(changed).toBe(true);
    expect(metadata.refundIssued).toBe(true);
    expect(metadata.refundAmount).toBe(400);
    expect(metadata.refundContext).toBe('card_only');
    expect(typeof metadata.refundedAt).toBe('string');
  });

  it('clears a stale skip marker: issuing supersedes the prior pass verdict', () => {
    // A retry that debited after a no-charge race really collected;
    // leaving refundSkipped alongside refundIssued would lie to
    // future readers (guards exempt marked rows from confirmation).
    const metadata: Record<string, unknown> = { refundSkipped: 'no_charge' };

    const changed = applyRefundMetadata(metadata, 400, 'card_only');

    expect(changed).toBe(true);
    expect(metadata.refundIssued).toBe(true);
    expect(metadata).not.toHaveProperty('refundSkipped');
  });
});

describe('refundHybridWalletRace', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records wallet-only races as a no-charge skip without calling the refund RPC', async () => {
    const { rpc, supabase } = createSupabase();
    const metadata: Record<string, unknown> = {};

    const result = await refundHybridWalletRace({
      metadata,
      row: ROW as never,
      supabase,
      paymentSplit: { card: 0, wallet: 1000 },
    });

    // No RPC ran and zero funds moved: skipped, NOT issued, so
    // clients report no-charge rather than "refunded" (R116 P2).
    expect(result).toEqual({
      metadataChanged: true,
      refundIssued: false,
      refundedAmount: 0,
    });
    expect(metadata.refundSkipped).toBe('no_charge');
    expect(metadata.refundIssued).toBeUndefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refunds the card leg when one was collected', async () => {
    const { rpc, supabase } = createSupabase();
    const metadata: Record<string, unknown> = {};

    const result = await refundHybridWalletRace({
      metadata,
      row: ROW as never,
      supabase,
      paymentSplit: { card: 400, wallet: 600 },
    });

    expect(result.refundedAmount).toBe(400);
    expect(result.refundIssued).toBe(true);
    expect(metadata.refundContext).toBe('wallet_race');
    expect(rpc).toHaveBeenCalledWith(
      'refund_customer_wallet_for_vtu',
      expect.objectContaining({ p_amount: 400 })
    );
  });

  it('returns zeros when the card-leg refund RPC fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { supabase } = createSupabase({ rpcError: { message: 'down' } });

    const result = await refundHybridWalletRace({
      metadata: {},
      row: ROW as never,
      supabase,
      paymentSplit: { card: 400, wallet: 600 },
    });

    expect(result).toEqual({
      metadataChanged: false,
      refundIssued: false,
      refundedAmount: 0,
    });
  });
});

describe('refundHybridKudaFailure', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reverses the wallet leg and reports the total while persisting the card leg', async () => {
    const { rpc, supabase } = createSupabase();
    const metadata: Record<string, unknown> = {};

    const result = await refundHybridKudaFailure({
      metadata,
      row: ROW as never,
      supabase,
      paymentSplit: { card: 0, wallet: 1000 },
    });

    expect(result).toEqual({
      metadataChanged: true,
      refundIssued: true,
      refundedAmount: 1000,
    });
    expect(metadata.refundAmount).toBe(0);
    expect(metadata.refundContext).toBe('hybrid_vend_failure');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      'reverse_vtu_wallet_payment',
      expect.objectContaining({ p_vtu_transaction_id: 'vtu-tx-1' })
    );
  });

  it('returns zeros when the wallet reversal fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { supabase } = createSupabase({ rpcError: { message: 'down' } });

    const result = await refundHybridKudaFailure({
      metadata: {},
      row: ROW as never,
      supabase,
      paymentSplit: { card: 0, wallet: 1000 },
    });

    expect(result.refundIssued).toBe(false);
    expect(result.refundedAmount).toBe(0);
  });
});

describe('refundCardOnly', () => {
  it('refunds the full total with the card_only label', async () => {
    const { rpc, supabase } = createSupabase();
    const metadata: Record<string, unknown> = {};

    const result = await refundCardOnly({
      metadata,
      row: ROW as never,
      supabase,
      totalAmount: 1000,
    });

    expect(result).toEqual({
      metadataChanged: true,
      refundIssued: true,
      refundedAmount: 1000,
    });
    expect(metadata.refundContext).toBe('card_only');
    expect(rpc).toHaveBeenCalledWith(
      'refund_customer_wallet_for_vtu',
      expect.objectContaining({ p_amount: 1000 })
    );
  });
});

describe('findExistingVtuRefundLedger', () => {
  it('returns the ledger amount when a refund row exists', async () => {
    const { supabase } = createSupabase({ ledgerData: { amount: 400 } });

    await expect(
      findExistingVtuRefundLedger({ row: ROW as never, supabase })
    ).resolves.toEqual({ amount: 400 });
  });

  it('returns null without querying when the row has no customer', async () => {
    const { from, supabase } = createSupabase();

    await expect(
      findExistingVtuRefundLedger({
        row: { ...ROW, customer_id: null } as never,
        supabase,
      })
    ).resolves.toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it('returns null when no refund row exists', async () => {
    const { supabase } = createSupabase({ ledgerData: null });

    await expect(
      findExistingVtuRefundLedger({ row: ROW as never, supabase })
    ).resolves.toBeNull();
  });

  it('throws fail-closed when the ledger lookup errors', async () => {
    const { supabase } = createSupabase({
      ledgerError: { message: 'down' },
    });

    await expect(
      findExistingVtuRefundLedger({ row: ROW as never, supabase })
    ).rejects.toThrow(/verify VTU refund ledger/);
  });
});
