import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { storedPvbCreditRowSchemas } from '@/schemas/piggyvest/stored-pvb-credit-rows';
import {
  creditWriteFailureMessage,
  readStoredPvbCredit,
} from './stored-pvb-credit';
import { createPiggyvestIntakeClientFromExecutor } from './webhook-intake-client';
import { PiggyvestIntakeDbError } from './webhook-intake-executor';

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

    await expect(readStoredPvbCredit(supabase, input)).resolves.toEqual({
      row: ROW,
      legacyKeyOwnedByOther: false,
    });
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

    await expect(readStoredPvbCredit(supabase, input)).resolves.toEqual({
      row: legacy,
      legacyKeyOwnedByOther: false,
    });
    expect(calls.map((call) => call.column)).toEqual([
      'pvb_reference',
      'provider_payout_id',
    ]);
  });

  it('flags an incoming internal id already owned by a different credit', async () => {
    // Stored A/payout-0 and B/payout-1; incoming A/payout-1.
    const { supabase } = client({
      pvb_reference: {
        data: { ...ROW, provider_payout_id: 'payout-0' },
        error: null,
      },
      provider_payout_id: {
        data: { ...ROW, pvb_reference: 'PVB01OTHER' },
        error: null,
      },
    });

    await expect(readStoredPvbCredit(supabase, input)).resolves.toMatchObject({
      legacyKeyOwnedByOther: true,
    });
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

describe('creditWriteFailureMessage', () => {
  it('names the legacy-row gate so it is not mistaken for an outage', () => {
    expect(
      creditWriteFailureMessage(
        { code: '55000' },
        'Inflow credit record failed'
      )
    ).toContain('legacy ledger row without pvb_reference');
  });

  it('keeps the generic message for any other storage error', () => {
    expect(
      creditWriteFailureMessage(
        { code: '08006' },
        'Inflow credit record failed'
      )
    ).toBe('Inflow credit record failed');
  });
});

describe('legacy-row gate diagnostic through the intake facade', () => {
  it('keeps SQLSTATE 55000 from the intake insert so the ledger names the repair', async () => {
    const execute = vi.fn(async () => {
      throw new PiggyvestIntakeDbError('55000');
    });
    const client = createPiggyvestIntakeClientFromExecutor(execute);

    const { error } = await client
      .from('piggyvest_inflow_credits')
      .upsert({ pvb_reference: 'PVB01GATED' } as never)
      .select('pvb_reference');

    expect(error).toMatchObject({ code: '55000' });
    expect(
      creditWriteFailureMessage(error, 'Inflow credit record failed')
    ).toContain('legacy ledger row without pvb_reference');
  });
});
