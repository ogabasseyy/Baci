/**
 * Provider-submission marker persistence.
 *
 * Extracted from `vtu-flagged-recovery.ts` per the 300-line Boy
 * Scout Rule (Codex R56 6rrhXt): the marker write + read-back
 * verify live here; the stranded-row classifiers stay in the
 * recovery module.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Metadata key: ISO timestamp fulfill persists immediately BEFORE
 * the first provider submission. Marker absence on a stale
 * marker-era row proves no provider call ever ran (every submission
 * path writes it first), which is what lets the reconciler re-drive
 * the row with the same request reference instead of stranding the
 * debit forever — no provider idempotency needed, since the
 * reference submits for the first time.
 */
export const VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY =
  'providerSubmissionStartedAt';

/**
 * Persists the provider-submission marker immediately before the
 * first provider call (see VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY).
 * Returns the persist error message, or null on success (row
 * metadata is updated in place so downstream code sees the
 * marker). Fail closed: the caller must NOT vend when this fails —
 * without the marker the row is indistinguishable from a
 * submitted-but-unpersisted vend, which must never re-drive.
 *
 * Read-back verify (Codex R54 6rrFRC): the UPDATE may have
 * committed while its response was lost (timeout/kill during the
 * RTT). Without a re-read that row sits processing with the marker
 * and no provider reference — the reconciler can neither re-drive
 * it (marker presence fails the unsubmitted proof) nor settle it
 * (nothing to requery). A re-read marker with no response
 * reference is provably OURS — this worker never dispatched a
 * provider call on the linear path here, and every other vend
 * entry needs a stale-or-pending row — so adopt it and proceed to
 * the vend. Any other outcome (re-read error, vanished row, moved
 * status, or a response reference) keeps the original error and
 * the caller's CAS-guarded restore.
 */
export async function markVtuProviderSubmissionStarted({
  row,
  supabase,
}: {
  row: { id: string; metadata?: Record<string, unknown> | null };
  supabase: SupabaseClient;
}): Promise<{ message: string } | null> {
  const metadata = {
    ...(row.metadata ?? {}),
    [VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY]: new Date().toISOString(),
  };
  const { error } = await supabase
    .from('vtu_transactions')
    .update({ metadata })
    .eq('id', row.id);
  if (!error) {
    row.metadata = metadata;
    return null;
  }
  const { data: current, error: rereadError } = await supabase
    .from('vtu_transactions')
    .select('metadata, status, transaction_id')
    .eq('id', row.id)
    .maybeSingle();
  if (rereadError || !current) {
    return { message: error.message };
  }
  const currentMetadata =
    current.metadata !== null &&
    typeof current.metadata === 'object' &&
    !Array.isArray(current.metadata)
      ? (current.metadata as Record<string, unknown>)
      : null;
  const markerPresent =
    currentMetadata !== null &&
    VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY in currentMetadata;
  const responsePersisted =
    (typeof current.transaction_id === 'string' &&
      current.transaction_id.trim() !== '') ||
    (typeof currentMetadata?.monnifyVendReference === 'string' &&
      currentMetadata.monnifyVendReference.trim() !== '');
  if (!markerPresent || responsePersisted || current.status !== 'processing') {
    return { message: error.message };
  }
  row.metadata = currentMetadata;
  return null;
}
