import type { SupabaseClient } from '@supabase/supabase-js';
import { throwVtuPersistenceError } from '@/lib/vtu-persistence-error';

/** Minimal row shape the debit lookup needs (structural; no import cycle). */
export interface VtuDebitLedgerRow {
  customer_id?: string | null;
  id: string;
  merchant_id?: string | null;
}

/**
 * True when the wallet ledger holds a redemption for this VTU
 * transaction (Codex R39 rldXK). Mirrors `findExistingVtuRefundLedger`:
 * same table, same fail-closed read contract — the ledger is the
 * source of truth for whether money moved.
 *
 * Gates the stranded pre-vend flip: only debited strands are
 * auto-recovered (money moved → duty to complete; re-drive is
 * idempotent-safe via the redeem RPC's cached row). A never-debited
 * strand may be a terminal insufficient-balance decline whose
 * failed-persist exhausted — byte-identical to a crash strand — so
 * flipping it would let a later top-up vend a rejected purchase with
 * no new submission.
 *
 * Fail closed: a ledger-read failure throws (no flip) instead of
 * guessing — the next pass retries the check.
 */
export async function hasExistingVtuDebitLedger({
  row,
  supabase,
}: {
  row: VtuDebitLedgerRow;
  supabase: SupabaseClient;
}): Promise<boolean> {
  if (!row.customer_id) return false;
  const { data, error } = await supabase
    .from('customer_wallet_transactions')
    .select('id')
    .eq('customer_id', row.customer_id)
    .eq('merchant_id', row.merchant_id)
    .eq('source_type', 'vtu_wallet_payment')
    .eq('source_id', row.id)
    .eq('type', 'redemption')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throwVtuPersistenceError(
      `Failed to verify VTU debit ledger before recovery: ${error.message}`
    );
  }
  if (!data) return false;
  return true;
}
