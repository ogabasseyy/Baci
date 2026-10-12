import type { SupabaseClient } from '@supabase/supabase-js';

/** Metadata key stamped by `mark_vtu_wallet_debit_declined`. */
export const VTU_DEBIT_DECLINED_MARKER_KEY =
  'walletDebitDeclinedInsufficientBalanceAt';

// Bounded retry mirrors the pre-vend restore (3 attempts, 100/250ms
// backoff): the marker fires adjacent to the provably-live debit RPC,
// so a blip here usually self-heals within the same failure path.
const DECLINE_MARKER_MAX_ATTEMPTS = 3;
const DECLINE_MARKER_BACKOFF_MS = [100, 250] as const;

/**
 * Best-effort durable marker for an insufficient-balance debit
 * decline (Codex R38 rlFA4). Call IMMEDIATELY after
 * `redeem_vtu_wallet_payment` reports insufficient balance, BEFORE
 * the refund + failed-payload writes: if that persistence later
 * exhausts its retries, the row would otherwise be byte-identical to
 * a crash-before-debit strand, and the stranded pre-vend recovery
 * would flip it to pending — letting a later top-up auto-debit and
 * vend a purchase the customer was told failed. Marked rows are
 * excluded from automatic re-drive (see `isStrandedPreVendVtuRow`).
 *
 * Never throws: on exhaustion it only logs (the caller still runs
 * its refund + failed-payload persistence, which usually lands and
 * moots the marker — `failed` rows are never recovery candidates).
 * The patch itself is atomic server-side (single UPDATE in
 * `mark_vtu_wallet_debit_declined`), so concurrent metadata writers
 * never lose keys to a stale snapshot.
 */
export async function markVtuWalletDebitDeclined({
  declinedAt,
  supabase,
  transactionId,
}: {
  declinedAt: string;
  supabase: SupabaseClient;
  transactionId: string;
}): Promise<void> {
  let lastErrorMessage: string | null = null;
  for (let attempt = 1; attempt <= DECLINE_MARKER_MAX_ATTEMPTS; attempt += 1) {
    const { error } = await supabase.rpc('mark_vtu_wallet_debit_declined', {
      p_declined_at: declinedAt,
      p_transaction_id: transactionId,
    });
    if (!error) {
      return;
    }
    lastErrorMessage = error instanceof Error ? error.message : String(error);
    if (attempt < DECLINE_MARKER_MAX_ATTEMPTS) {
      const delayMs =
        DECLINE_MARKER_BACKOFF_MS[
          Math.min(attempt - 1, DECLINE_MARKER_BACKOFF_MS.length - 1)
        ];
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  console.error('Failed to mark VTU wallet debit declined:', {
    attempts: DECLINE_MARKER_MAX_ATTEMPTS,
    error: lastErrorMessage,
    transactionId,
  });
}
