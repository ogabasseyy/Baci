import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { hasExistingVtuDebitLedger } from './vtu-debit-ledger-lookup';

describe('hasExistingVtuDebitLedger', () => {
  function buildSupabase(ledgerResult: {
    data: unknown;
    error: { message: string } | null;
  }): { eq: ReturnType<typeof vi.fn>; supabase: SupabaseClient } {
    const maybeSingle = vi.fn().mockResolvedValue(ledgerResult);
    const chain = {
      eq: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      maybeSingle,
      order: vi.fn(() => chain),
    };
    const from = vi.fn(() => ({
      select: vi.fn(() => chain),
    }));
    return {
      eq: chain.eq,
      supabase: { from } as unknown as SupabaseClient,
    };
  }

  const row = {
    customer_id: 'customer-1',
    id: 'vtu-tx-1',
    merchant_id: 'merchant-1',
  };

  it('returns true when a redemption row exists for the transaction', async () => {
    const { eq, supabase } = buildSupabase({
      data: { id: 'ledger-1' },
      error: null,
    });

    await expect(hasExistingVtuDebitLedger({ row, supabase })).resolves.toBe(
      true
    );
    expect(eq).toHaveBeenCalledWith('source_type', 'vtu_wallet_payment');
    expect(eq).toHaveBeenCalledWith('source_id', 'vtu-tx-1');
    expect(eq).toHaveBeenCalledWith('type', 'redemption');
  });

  it('returns false when no redemption row exists', async () => {
    const { supabase } = buildSupabase({ data: null, error: null });

    await expect(hasExistingVtuDebitLedger({ row, supabase })).resolves.toBe(
      false
    );
  });

  it('returns false without a ledger read when the row has no customer', async () => {
    const { supabase } = buildSupabase({
      data: { id: 'ledger-1' },
      error: null,
    });

    await expect(
      hasExistingVtuDebitLedger({
        row: { ...row, customer_id: null },
        supabase,
      })
    ).resolves.toBe(false);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('throws (fail closed, no flip) when the ledger read fails', async () => {
    const { supabase } = buildSupabase({
      data: null,
      error: { message: 'connection reset' },
    });

    await expect(hasExistingVtuDebitLedger({ row, supabase })).rejects.toThrow(
      'Failed to verify VTU debit ledger before recovery'
    );
  });
});
