import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type z from 'zod';

/**
 * Reads the stored ledger row for a PVB credit.
 *
 * PiggyVest confirmed on 2026-11-11 that a credit's unique key is the
 * envelope `pvb_reference`, so the row is found by that key first. Rows
 * written before the pvb_reference migration may carry a NULL
 * pvb_reference (no inbox evidence to backfill from); those are found by the
 * legacy internal id the ledger used to key on. A legacy hit whose stored
 * pvb_reference is a different non-null value is returned as-is so the
 * caller's mismatch check reports it as a conflict, never a duplicate.
 *
 * Returns null when neither key finds a row. Throws on storage errors and
 * on rows that do not match the expected shape.
 */
export async function readStoredPvbCredit<Shape extends z.ZodRawShape>(
  supabase: SupabaseClient,
  input: {
    table: 'piggyvest_inflow_credits' | 'piggyvest_interest_payouts';
    schema: z.ZodObject<Shape>;
    pvbReference: string;
    legacyKeyColumn: 'provider_transaction_id' | 'provider_payout_id';
    legacyKey: string;
  }
): Promise<z.infer<z.ZodObject<Shape>> | null> {
  // Columns derive from the schema so the projection can never drift from
  // what the caller compares.
  const columns = Object.keys(input.schema.shape).join(', ');
  for (const [column, value] of [
    ['pvb_reference', input.pvbReference],
    [input.legacyKeyColumn, input.legacyKey],
  ] as const) {
    const { data, error } = await supabase
      .from(input.table)
      .select(columns)
      .eq(column, value)
      .maybeSingle();
    if (error) throw new Error('Stored credit read failed');
    if (data) return input.schema.parse(data);
  }
  return null;
}
