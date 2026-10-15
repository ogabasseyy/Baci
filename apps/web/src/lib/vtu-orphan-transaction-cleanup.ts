import type { SupabaseClient } from '@supabase/supabase-js';
import { VTU_CUSTOMER_SAFE_ERROR_MESSAGE_KEY } from '@/lib/vtu-metadata-fields';
import { VTU_REFUND_SKIPPED_NO_COLLECTION } from './vtu-refund-collection-evidence';

/** User-safe terminal message for a discarded race orphan (fixed template). */
export const VTU_ORPHAN_DISCARD_MESSAGE =
  'Duplicate checkout request discarded; no charge was made.';

export type OrphanVtuCleanupOutcome =
  | 'deleted'
  | 'marked_failed'
  | 'owned_elsewhere'
  | 'unresolved';

const ORPHAN_CLEANUP_MAX_ATTEMPTS = 3;
const ORPHAN_CLEANUP_BACKOFF_MS = [100, 250] as const;

interface OrphanCleanupAttempt {
  outcome: OrphanVtuCleanupOutcome;
  /** Error-driven failures are transient-plausible and worth a
   *  retry; deterministic observations (zero-match) re-observe the
   *  same state and return immediately. */
  retryable: boolean;
  /** Last transport error, for the exhausted-retries log only. */
  detail?: unknown;
}

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
 * of clobbering. Error-driven failures (delete/reread/mark
 * transport errors) retry in-request up to
 * ORPHAN_CLEANUP_MAX_ATTEMPTS with backoff: a transient blip must
 * not strand a pending orphan no reconciler can discover (Codex
 * R108 P2). Only sustained failure stays unresolved — the caller
 * proceeds (today's behavior) since no retry or cron can see an
 * unmapped row either, and a down database cannot persist a
 * cleanup marker anyway.
 */
async function attemptOrphanCleanupOnce({
  merchantId,
  supabase,
  transactionId,
}: {
  merchantId: string;
  supabase: SupabaseClient;
  transactionId: string;
}): Promise<OrphanCleanupAttempt> {
  const { data: deleted, error: deleteError } = await supabase
    .from('vtu_transactions')
    .delete()
    .eq('id', transactionId)
    .eq('status', 'pending')
    .eq('merchant_id', merchantId)
    .select('id')
    .maybeSingle();
  if (!deleteError && deleted) {
    return { outcome: 'deleted', retryable: false };
  }
  const { data: current, error: rereadError } = await supabase
    .from('vtu_transactions')
    .select('id, metadata, status')
    .eq('id', transactionId)
    .maybeSingle();
  if (rereadError) {
    return {
      detail: rereadError,
      outcome: 'unresolved',
      retryable: true,
    };
  }
  if (!current) {
    // The delete landed while its response was lost: gone is gone.
    return { outcome: 'deleted', retryable: false };
  }
  if (current.status !== 'pending') {
    console.error(
      'Orphan VTU transaction progressed under the key race; leaving it to its owner:',
      { status: current.status, transactionId }
    );
    return { outcome: 'owned_elsewhere', retryable: false };
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
        [VTU_CUSTOMER_SAFE_ERROR_MESSAGE_KEY]: true,
        refundSkipped: VTU_REFUND_SKIPPED_NO_COLLECTION,
      },
      status: 'failed',
    })
    .eq('id', transactionId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (markError) {
    return { detail: markError, outcome: 'unresolved', retryable: true };
  }
  if (!marked) {
    // Deterministic zero-match: the row provably left pending
    // between re-read and mark. Retrying re-observes the same
    // state, so return immediately (existing unresolved
    // contract); the loud log preserves the mystery for triage.
    console.error(
      'Orphan VTU transaction left pending between re-read and mark; leaving it to its owner:',
      { transactionId }
    );
    return { outcome: 'unresolved', retryable: false };
  }
  return { outcome: 'marked_failed', retryable: false };
}

export async function cleanupOrphanVtuTransactionAfterKeyRace({
  merchantId,
  supabase,
  transactionId,
}: {
  merchantId: string;
  supabase: SupabaseClient;
  transactionId: string;
}): Promise<OrphanVtuCleanupOutcome> {
  let attempt: OrphanCleanupAttempt = {
    outcome: 'unresolved',
    retryable: false,
  };
  for (
    let attemptNumber = 1;
    attemptNumber <= ORPHAN_CLEANUP_MAX_ATTEMPTS;
    attemptNumber++
  ) {
    attempt = await attemptOrphanCleanupOnce({
      merchantId,
      supabase,
      transactionId,
    });
    if (!attempt.retryable || attemptNumber === ORPHAN_CLEANUP_MAX_ATTEMPTS) {
      if (attempt.outcome === 'unresolved') {
        console.error(
          'Orphan VTU cleanup unresolved after exhausting retries:',
          {
            attempts: attemptNumber,
            error: attempt.detail ?? { transactionId },
            transactionId,
          }
        );
      }
      return attempt.outcome;
    }
    const delayMs =
      ORPHAN_CLEANUP_BACKOFF_MS[
        Math.min(attemptNumber - 1, ORPHAN_CLEANUP_BACKOFF_MS.length - 1)
      ];
    console.warn('Retrying orphan VTU cleanup after transient failure:', {
      attempt: attemptNumber,
      delayMs,
      maxAttempts: ORPHAN_CLEANUP_MAX_ATTEMPTS,
      transactionId,
    });
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return attempt.outcome;
}
