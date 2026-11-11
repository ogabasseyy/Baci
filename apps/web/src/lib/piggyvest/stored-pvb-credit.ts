import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import z from 'zod';

/** The identity columns every ledger row carries, read without casts. */
const rowKeysSchema = z.looseObject({
  pvb_reference: z.string().nullable(),
  provider_transaction_id: z.string().optional(),
  provider_payout_id: z.string().optional(),
});

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
 * Also reports when the incoming internal id is already owned by a
 * DIFFERENT stored credit (stored A/X and B/Y, incoming A/Y): the
 * pvb_reference hit alone would call it a duplicate, but the reuse of Y is
 * a provider conflict the caller must quarantine.
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
): Promise<{
  row: z.infer<z.ZodObject<Shape>>;
  legacyKeyOwnedByOther: boolean;
} | null> {
  // Columns derive from the schema so the projection can never drift from
  // what the caller compares. pvb_reference and the legacy key are always
  // in the schema; the legacy key is the table's primary key, so it is
  // never NULL on any row, legacy or new.
  const columns = Object.keys(input.schema.shape).join(', ');
  const read = async (column: string, value: string) => {
    const { data, error } = await supabase
      .from(input.table)
      .select(columns)
      .eq(column, value)
      .maybeSingle();
    if (error) throw new Error('Stored credit read failed');
    if (!data) return null;
    return { row: input.schema.parse(data), keys: rowKeysSchema.parse(data) };
  };

  const byReference = await read('pvb_reference', input.pvbReference);
  if (byReference) {
    let legacyKeyOwnedByOther = false;
    if (byReference.keys[input.legacyKeyColumn] !== input.legacyKey) {
      const owner = await read(input.legacyKeyColumn, input.legacyKey);
      legacyKeyOwnedByOther =
        owner !== null && owner.keys.pvb_reference !== input.pvbReference;
    }
    return { row: byReference.row, legacyKeyOwnedByOther };
  }
  const byLegacyKey = await read(input.legacyKeyColumn, input.legacyKey);
  return byLegacyKey
    ? { row: byLegacyKey.row, legacyKeyOwnedByOther: false }
    : null;
}

/** SQLSTATE the intake insert functions raise for the legacy-row gate. */
const LEGACY_REFERENCE_GATE = '55000';

/**
 * Storage-error message for a failed credit write. The legacy-row gate
 * (a customer still has a ledger row without pvb_reference) stays a
 * retryable storage error, but says so, so operators and log drains can tell
 * "needs a pvb_reference repair" from a database outage.
 */
export function creditWriteFailureMessage(
  error: { code?: string } | null,
  fallback: string
): string {
  return error?.code === LEGACY_REFERENCE_GATE
    ? `${fallback}: customer has a legacy ledger row without pvb_reference (run the pvb_reference repair)`
    : fallback;
}
