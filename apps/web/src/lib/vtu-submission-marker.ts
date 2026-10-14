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

// Bounded retry mirrors the pre-vend restore convention (3 attempts,
// 100/250ms backoff): the marker write is idempotent (same key), so a
// retry after an ambiguous failure re-asserts it — any acked write or
// adoptable re-read proves presence and the worker proceeds to the
// vend instead of stranding the row behind an unverifiable commit
// (Codex R79 6sO3vb).
const MARKER_WRITE_MAX_ATTEMPTS = 3;
const MARKER_WRITE_BACKOFF_MS = [100, 250] as const;

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
 * the vend.
 *
 * Ambiguous-write retry (Codex R79 6sO3vb): when the write errors
 * AND the re-read errors, returning failure leaves the caller to
 * restore with its pre-marker token — but a committed marker write
 * already advanced it, so the restore matches no rows and (for
 * Kuda) the debit strands processing with no provider call ever
 * made. So both phases retry: any acked write or adoptable re-read
 * converts the ambiguity into certainty and the worker proceeds.
 * Only definitive states exit early without retrying — a vanished
 * row, a moved status, or another worker's response reference mean
 * the state resolved against us. Genuinely-failed writes (re-read
 * shows no marker) also retry: the next attempt may land.
 * Residue: a DB outage outlasting all retries still strands the
 * same way — but then the whole checkout plane is down, the row
 * stays visibly processing for support, and no automatic action is
 * safe without Kuda dedupe/definitive-unknown evidence (the
 * flagged-recovery module records it as missing).
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
  let lastMessage = 'Failed to persist provider-submission marker';
  for (let attempt = 1; attempt <= MARKER_WRITE_MAX_ATTEMPTS; attempt += 1) {
    const { error } = await supabase
      .from('vtu_transactions')
      .update({ metadata })
      .eq('id', row.id);
    if (!error) {
      row.metadata = metadata;
      return null;
    }
    lastMessage = error.message;
    const { data: current, error: rereadError } = await supabase
      .from('vtu_transactions')
      .select('metadata, status, transaction_id')
      .eq('id', row.id)
      .maybeSingle();
    if (!rereadError) {
      if (!current) {
        // Vanished row: definitive — nothing to adopt or retry.
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
      if (
        markerPresent &&
        !responsePersisted &&
        current.status === 'processing'
      ) {
        row.metadata = currentMetadata;
        return null;
      }
      if (
        markerPresent ||
        responsePersisted ||
        current.status !== 'processing'
      ) {
        // Definitive: the state resolved against us (another worker
        // submitted or moved the row) — a retry cannot adopt, so fail
        // closed without burning attempts.
        return { message: error.message };
      }
      // Else: genuinely-failed write (readable row, still
      // processing, no marker, no response) — fall through and retry
      // the idempotent write below; the next attempt may land.
    }
    // Else: the re-read itself errored — fully ambiguous. Backoff,
    // then retry; a later write may ack or a later re-read may adopt.
    if (attempt < MARKER_WRITE_MAX_ATTEMPTS) {
      const backoffMs =
        MARKER_WRITE_BACKOFF_MS[
          Math.min(attempt - 1, MARKER_WRITE_BACKOFF_MS.length - 1)
        ];
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
  return { message: lastMessage };
}
