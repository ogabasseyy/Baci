import type { SupabaseClient } from '@supabase/supabase-js';
import { VTU_REFUND_SKIPPED_NO_COLLECTION } from './vtu-refund-collection-evidence';

/** User-safe terminal message for a discarded race orphan (fixed template). */
export const VTU_ORPHAN_DISCARD_MESSAGE =
  'Duplicate checkout request discarded; no charge was made.';

export type OrphanVtuCleanupOutcome =
  | 'deleted'
  | 'marked_failed'
  | 'owned_elsewhere'
  | 'unresolved';

/**
 * Removes a VTU row orphaned by a lost idempotency-key race: the row
 * was prepared, the key insert failed, and no client will ever
 * reference the row again. Verified delete first; when the delete
 * cannot be verified, fall back to a terminal failed mark instead
 * of logging and continuing (Muse R55 HIGH).
 *
 * Log-and-continue would leave a pending orphan behind: a
 * stuck-pending history spinner today, and a second debit if any
 * reconciler ever fulfills unmapped pendings — the exact hazard
 * this cleanup exists for. The failed mark closes both: failed
 * rows are never fulfilled (wallet-only clients cannot
 * retryFailed; only the confirm path passes it, for its own
 * metadata-linked rows), and the refund gate skips them (prepare
 * never collects, so no evidence can exist — the skip marker is
 * pre-set rather than re-derived).
 *
 * Recovery semantics: a delete that errors but actually landed
 * (re-read finds no row) counts as deleted. A re-read row that is
 * no longer pending is owned elsewhere — claimed or settled by a
 * worker this orphan should never have met (log loudly; do NOT
 * mark over a live row). Only a still-pending re-read is marked,
 * CAS'd on status so a concurrent transition zero-matches instead
 * of clobbering. Anything else is unresolved — sustained outage;
 * the caller proceeds (today's behavior) since no retry or cron
 * can see an unmapped row either.
 */
export async function cleanupOrphanVtuTransactionAfterKeyRace({
  merchantId,
  supabase,
  transactionId,
}: {
  merchantId: string;
  supabase: SupabaseClient;
  transactionId: string;
}): Promise<OrphanVtuCleanupOutcome> {
  const { data: deleted, error: deleteError } = await supabase
    .from('vtu_transactions')
    .delete()
    .eq('id', transactionId)
    .eq('status', 'pending')
    .eq('merchant_id', merchantId)
    .select('id')
    .maybeSingle();
  if (!deleteError && deleted) {
    return 'deleted';
  }
  if (deleteError) {
    console.error(
      'Failed to delete orphan VTU transaction after idempotency-key race:',
      deleteError
    );
  }
  const { data: current, error: rereadError } = await supabase
    .from('vtu_transactions')
    .select('id, metadata, status')
    .eq('id', transactionId)
    .maybeSingle();
  if (rereadError) {
    console.error(
      'Failed to re-read orphan VTU transaction after unverified delete:',
      rereadError
    );
    return 'unresolved';
  }
  if (!current) {
    // The delete landed while its response was lost: gone is gone.
    return 'deleted';
  }
  if (current.status !== 'pending') {
    console.error(
      'Orphan VTU transaction progressed under the key race; leaving it to its owner:',
      { status: current.status, transactionId }
    );
    return 'owned_elsewhere';
  }
  const currentMetadata =
    current.metadata !== null &&
    typeof current.metadata === 'object' &&
    !Array.isArray(current.metadata)
      ? (current.metadata as Record<string, unknown>)
      : {};
  const { data: marked, error: markError } = await supabase
    .from('vtu_transactions')
    .update({
      error_message: VTU_ORPHAN_DISCARD_MESSAGE,
      metadata: {
        ...currentMetadata,
        refundSkipped: VTU_REFUND_SKIPPED_NO_COLLECTION,
      },
      status: 'failed',
    })
    .eq('id', transactionId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (markError || !marked) {
    console.error(
      'Failed to mark orphan VTU transaction failed after unverified delete:',
      markError ?? { transactionId }
    );
    return 'unresolved';
  }
  return 'marked_failed';
}
