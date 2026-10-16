import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExistingIdempotencyRow } from './vtu-idempotency-key-lookup';

/**
 * Idempotency-key replay binding for the wallet-only checkout route.
 *
 * Extracted from `route.ts` (Codex R120 P1) per the 300-line ceiling:
 * the route guards validate the IDEMPOTENCY row's owner, but
 * fulfillment debits/refunds from the TRANSACTION row — this module
 * binds the two before any replay fulfills, so a key↔tx
 * inconsistency (orphan leftovers, manual repair) can never
 * transact as the wrong customer. The key-row lookup lives in
 * `vtu-idempotency-key-lookup.ts` (Codex R122 P1, one primary
 * export per file); merging the two lookups into one operation
 * was rejected because the route runs ownership + fingerprint
 * guards between them and the error precedence must not change.
 */

export interface ReplayTransactionBinding {
  customer_id: string | null;
  id: string;
  merchant_id: string | null;
  status: string | null;
}

async function findReplayTransactionBinding(
  supabase: SupabaseClient,
  transactionId: string
): Promise<ReplayTransactionBinding | null> {
  const { data, error } = await supabase
    .from('vtu_transactions')
    .select('id, customer_id, merchant_id, status')
    .eq('id', transactionId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to look up replay transaction: ${error.message}`);
  }
  return (data as ReplayTransactionBinding | null) ?? null;
}

export type ReplayBindingVerdict =
  | { bound: ReplayTransactionBinding }
  | { error: string };

/**
 * Binds a validated idempotency row to its transaction row. Lookup
 * failures throw (fail closed → 500, the client keeps the key);
 * missing/mismatched rows return a 400-safe message (the client
 * rotates to a fresh purchase — terminal for this key).
 */
export async function verifyReplayTransactionBinding({
  supabase,
  keyRow,
}: {
  supabase: SupabaseClient;
  keyRow: ExistingIdempotencyRow;
}): Promise<ReplayBindingVerdict> {
  const bound = await findReplayTransactionBinding(
    supabase,
    keyRow.vtu_transaction_id
  );
  if (!bound) {
    return {
      error:
        'Purchase for this Idempotency-Key no longer exists. Please start a new purchase.',
    };
  }
  if (
    bound.customer_id !== keyRow.customer_id ||
    bound.merchant_id !== keyRow.merchant_id
  ) {
    // The key itself is the unguessable replay credential — log the
    // transaction id instead (Muse R108 MEDIUM).
    console.error('Idempotency-Key transaction owner mismatch:', {
      keyCustomerId: keyRow.customer_id,
      keyMerchantId: keyRow.merchant_id,
      status: bound.status,
      transactionCustomerId: bound.customer_id,
      transactionId: bound.id,
      transactionMerchantId: bound.merchant_id,
    });
    return { error: 'Idempotency-Key does not belong to this purchase.' };
  }
  return { bound };
}
