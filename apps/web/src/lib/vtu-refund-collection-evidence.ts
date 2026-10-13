import type { SupabaseClient } from '@supabase/supabase-js';
import { hasExistingVtuDebitLedger } from '@/lib/vtu-debit-ledger-lookup';
import { extractMetadataField, isString } from '@/lib/vtu-metadata-fields';
import { throwVtuPersistenceError } from '@/lib/vtu-persistence-error';

/**
 * Metadata key marking a failed row the refund path deliberately did
 * NOT credit: no collection evidence exists (no wallet debit, no
 * completed gateway transaction), so crediting would mint unearned
 * wallet funds. The reconciliation failed clause excludes marked
 * rows and history clears their refund_pending — the row is
 * terminally failed, not awaiting a refund.
 */
export const VTU_REFUND_SKIPPED_KEY = 'refundSkipped';

/** refundSkipped value: skipped for lack of collection evidence. */
export const VTU_REFUND_SKIPPED_NO_COLLECTION = 'no_collection_evidence';

/** Minimal row shape the evidence check needs. */
export interface VtuCollectionEvidenceRow {
  customer_id?: string | null;
  id: string;
  merchant_id?: string | null;
  order_id?: string | null;
  transaction_id?: string | null;
}

/**
 * True when money provably moved for a failed row that carries no
 * paymentSplit (legacy card-only shape — current checkout rows
 * always persist a split at prepare time). Gates refundCardOnly:
 * legacy failures include gateway-init and declined-authorization
 * rows that never collected, and crediting those mints unearned
 * wallet funds (Codex R51 6rqH1I).
 *
 * Evidence, in order (free checks first):
 * 1. metadata.walletDebited — the debit RPC succeeded (wallet leg).
 * 2. A provider reference (transaction_id or monnifyVendReference):
 *    both persist ONLY from provider responses, so a reference
 *    proves a provider call returned — and every flow collects
 *    before its first provider call (wallet debit precedes the
 *    vend; card flows charge before the row is created).
 * 3. A wallet-ledger redemption for this transaction id.
 * 4. A COMPLETED gateway transaction (card leg) linked by the row's
 *    paymentReference or order_id — the saved-card path stores its
 *    reference on the transactions row only. A missing link, a
 *    missing row, or any non-completed status is not evidence:
 *    declined/pending gateway rows never collected.
 *
 * Fail closed: a ledger/gateway read error throws (retryable —
 * clients keep the key, the cron retries) instead of guessing.
 */
export async function hasVtuCollectionEvidence({
  metadata,
  row,
  supabase,
}: {
  metadata: Record<string, unknown>;
  row: VtuCollectionEvidenceRow;
  supabase: SupabaseClient;
}): Promise<boolean> {
  if (metadata.walletDebited === true) {
    return true;
  }
  if (
    (typeof row.transaction_id === 'string' &&
      row.transaction_id.trim() !== '') ||
    (typeof metadata.monnifyVendReference === 'string' &&
      metadata.monnifyVendReference)
  ) {
    return true;
  }
  if (await hasExistingVtuDebitLedger({ row, supabase })) {
    return true;
  }
  const paymentReference = extractMetadataField(
    metadata,
    'paymentReference',
    isString
  );
  // Separate queries (not .or()): reference values are interpolated
  // into the PostgREST or-string unsafely, while .eq() binds them.
  if (paymentReference) {
    const { data, error } = await supabase
      .from('transactions')
      .select('status')
      .eq('merchant_id', row.merchant_id)
      .eq('gateway_reference', paymentReference);
    if (error) {
      throwVtuPersistenceError(
        `Failed to verify gateway collection evidence before VTU refund: ${error.message}`
      );
    }
    if (
      (data ?? []).some(
        (transaction: { status?: unknown }) =>
          transaction.status === 'completed'
      )
    ) {
      return true;
    }
  }
  if (typeof row.order_id === 'string' && row.order_id) {
    const { data, error } = await supabase
      .from('transactions')
      .select('status')
      .eq('merchant_id', row.merchant_id)
      .eq('order_id', row.order_id);
    if (error) {
      throwVtuPersistenceError(
        `Failed to verify order collection evidence before VTU refund: ${error.message}`
      );
    }
    if (
      (data ?? []).some(
        (transaction: { status?: unknown }) =>
          transaction.status === 'completed'
      )
    ) {
      return true;
    }
  }
  return false;
}
