import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * User-safe terminal message for a discarded race orphan (fixed
 * template). Mirrored inside the fail_orphan_vtu_transaction RPC —
 * keep the two in sync.
 */
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
 * reference the row again. Runs inside the ownership-verifying
 * `fail_orphan_vtu_transaction` RPC (Phase 2, epic #3694 — no buyer
 * UPDATE/DELETE policy exists by design): verified delete first;
 * when the delete cannot be verified, a terminal failed mark
 * instead of logging and continuing (Muse R55 HIGH).
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
 * Recovery semantics: RPC transport errors retry in-request up to
 * ORPHAN_CLEANUP_MAX_ATTEMPTS with backoff (a transient blip must
 * not strand a pending orphan no reconciler can discover (Codex
 * R108 P2); the RPC is idempotent so retries are safe). Verdicts
 * are terminal observations and return immediately. Only sustained
 * failure stays unresolved — the caller proceeds (today's
 * behavior) since no retry or cron can see an unmapped row
 * either, and a down database cannot persist a cleanup marker
 * anyway.
 */
async function attemptOrphanCleanupOnce({
  merchantId,
  supabase,
  transactionId,
  userId,
}: {
  merchantId: string;
  supabase: SupabaseClient;
  transactionId: string;
  userId: string;
}): Promise<OrphanCleanupAttempt> {
  const { data: verdict, error } = await supabase.rpc(
    'fail_orphan_vtu_transaction',
    {
      p_transaction_id: transactionId,
      p_merchant_id: merchantId,
      p_user_id: userId,
    }
  );
  if (error) {
    return {
      detail: error,
      outcome: 'unresolved',
      retryable: true,
    };
  }
  if (verdict === 'deleted' || verdict === 'marked_failed') {
    return { outcome: verdict, retryable: false };
  }
  if (verdict === 'owned_elsewhere') {
    // The row progressed under the key race — claimed or settled
    // by a worker this orphan should never have met. Log loudly;
    // the RPC never marks over a live row.
    console.error(
      'Orphan VTU transaction progressed under the key race; leaving it to its owner:',
      { transactionId }
    );
    return { outcome: 'owned_elsewhere', retryable: false };
  }
  if (verdict === 'unresolved') {
    // Deterministic CAS loss: the row provably left pending
    // mid-mark. Retrying re-observes the same state, so return
    // immediately (existing unresolved contract).
    return { outcome: 'unresolved', retryable: false };
  }
  // Unknown verdict (transport-mangled?): fail closed into the
  // retryable path; sustained failure stays unresolved.
  console.error('Orphan VTU cleanup returned an unknown verdict:', {
    transactionId,
    verdict,
  });
  return { outcome: 'unresolved', retryable: true };
}

export async function cleanupOrphanVtuTransactionAfterKeyRace({
  merchantId,
  supabase,
  transactionId,
  userId,
}: {
  merchantId: string;
  supabase: SupabaseClient;
  transactionId: string;
  userId: string;
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
      userId,
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
