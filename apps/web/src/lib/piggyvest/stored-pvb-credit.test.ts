import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { storedPvbCreditRowSchemas } from '@/schemas/piggyvest/stored-pvb-credit-rows';
import { readStoredPvbCredit } from './stored-pvb-credit';

const ROW = {
  pvb_reference: 'PVB01SYNTHETIC',
  provider_payout_id: 'payout-1',
  customer_id: 'customer',
  wallet_id: 'wallet',
  amount_kobo: 90,
  gross_kobo: 100,
  withholding_tax_kobo: 10,
  net_kobo: 90,
  reference: 'ref',
  batch_id: 'batch',
  paid_at: '2026-11-11 10:00:00+00',
};

type Lookup = { data: unknown; error: unknown };

function client(byColumn: Record<string, Lookup>) {
  const calls: { columns: string; column: string; value: unknown }[] = [];
  const supabase = {
    from: vi.fn(() => ({
      select: (columns: string) => ({
        eq: (column: string, value: unknown) => ({
          maybeSingle: async () => {
            calls.push({ columns, column, value });
            return byColumn[column] ?? { data: null, error: null };
          },
        }),
      }),
    })),
  } as unknown as SupabaseClient;
  return { supabase, calls };
}

const input = {
  table: 'piggyvest_interest_payouts' as const,
  schema: storedPvbCreditRowSchemas.interest,
  pvbReference: 'PVB01SYNTHETIC',
  legacyKeyColumn: 'provider_payout_id' as const,
  legacyKey: 'payout-1',
};

describe('readStoredPvbCredit', () => {
  it('finds the row by pvb_reference first, selecting the schema columns', async () => {
    const { supabase, calls } = client({
      pvb_reference: { data: ROW, error: null },
    });

    await expect(readStoredPvbCredit(supabase, input)).resolves.toEqual(ROW);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      column: 'pvb_reference',
      value: 'PVB01SYNTHETIC',
    });
    expect(calls[0]?.columns).toBe(
      Object.keys(storedPvbCreditRowSchemas.interest.shape).join(', ')
    );
  });

  it('falls back to the legacy key for a pre-migration row', async () => {
    const legacy = { ...ROW, pvb_reference: null };
    const { supabase, calls } = client({
      provider_payout_id: { data: legacy, error: null },
    });

    await expect(readStoredPvbCredit(supabase, input)).resolves.toEqual(legacy);
    expect(calls.map((call) => call.column)).toEqual([
      'pvb_reference',
      'provider_payout_id',
    ]);
  });

  it('returns null when neither key finds a row', async () => {
    const { supabase } = client({});
    await expect(readStoredPvbCredit(supabase, input)).resolves.toBeNull();
  });

  it('throws on a storage error', async () => {
    const { supabase } = client({
      pvb_reference: { data: null, error: { message: 'down' } },
    });
    await expect(readStoredPvbCredit(supabase, input)).rejects.toThrow(
      'Stored credit read failed'
    );
  });

  it('throws on a row that does not match the schema', async () => {
    const { supabase } = client({
      pvb_reference: { data: { ...ROW, net_kobo: -1 }, error: null },
    });
    await expect(readStoredPvbCredit(supabase, input)).rejects.toThrow();
  });
});
