import type { SupabaseClient } from '@supabase/supabase-js';

/** Minimal row shape the restore needs (structural; no import cycle). */
export interface PreVendRestoreRow {
  id: string;
  metadata?: Record<string, unknown> | null;
}

// Bounded retry mirrors vtu-fulfillment's purchase-result persistence
// (3 attempts, 100/250ms backoff): the restore usually fails on the
// same transient blip as the write it follows, so immediate retries
// self-heal instead of stranding the row.
const PRE_VEND_RESTORE_MAX_ATTEMPTS = 3;
const PRE_VEND_RESTORE_BACKOFF_MS = [100, 250] as const;

/**
 * Staleness gate for reconciler-driven recovery of stranded pre-vend
 * rows. A live worker holds a reference-less processing row for at
 * most one provider financial call (30s timeout) plus settle writes,
 * so 5 minutes without a write proves no worker is driving it — the
 * flip back to pending cannot race a live vend.
 */
export const STRANDED_PRE_VEND_STALE_MS = 5 * 60 * 1000;

/** Structural shape the stranded-row predicate needs. */
export interface StrandedPreVendRowCandidate {
  error_message?: string | null;
  id: string;
  metadata?: Record<string, unknown> | null;
  status?: string | null;
  transaction_id?: string | null;
  updated_at?: string | null;
}

/**
 * True for a processing row whose pre-vend restore failed while the
 * database was down: no provider reference, no provider message (so
 * the reconciliation claim declines it), no Monnify vend reference,
 * NO persisted walletDebited flag, and stale enough that no live
 * worker can hold it. The flag absence is the pre-vend proof: the
 * flag persists before the first provider call, so a post-vend
 * persistence failure (vend landed, result write exhausted — same
 * reference-less shape) always carries the flag and is declined.
 * Flipping a flagged row would re-vend and double-credit at the
 * provider. A flip re-drives claim → idempotent debit → first vend.
 */
export function isStrandedPreVendVtuRow(
  row: StrandedPreVendRowCandidate,
  nowMs: number = Date.now()
): boolean {
  if (row.status !== 'processing') {
    return false;
  }
  if (row.transaction_id?.trim()) {
    return false;
  }
  if (row.error_message?.trim()) {
    return false;
  }
  const vendReference = row.metadata?.monnifyVendReference;
  if (typeof vendReference === 'string' && vendReference) {
    return false;
  }
  // Pre-vend proof (see docblock): a landed vend always has the flag.
  if (row.metadata?.walletDebited === true) {
    return false;
  }
  if (!row.updated_at) {
    return false;
  }
  const updatedAtMs = new Date(row.updated_at).getTime();
  if (!Number.isFinite(updatedAtMs)) {
    return false;
  }
  return nowMs - updatedAtMs > STRANDED_PRE_VEND_STALE_MS;
}

/**
 * Best-effort restore for pre-vend interruptions (debit RPC error,
 * walletDebited metadata write failure): flips the claimed row back
 * to pending with a resume marker so client retry AND the cron
 * re-drive it (claim → debit, idempotent → vend). Without this the
 * row sits processing with no provider reference, which the
 * reconciliation claim declines — debited with no vend or refund,
 * forever. Retries transient write failures; if every attempt fails
 * it only logs (the caller still throws the original error), and the
 * reconciler's stranded-row recovery flips it once stale. Extracted
 * from vtu-fulfillment.ts per the Boy Scout Rule (that module is
 * over the 300-line budget).
 */
export async function restoreInterruptedPreVendVtuRow({
  errorMessage,
  row,
  supabase,
}: {
  errorMessage: string;
  row: PreVendRestoreRow;
  supabase: SupabaseClient;
}): Promise<void> {
  let lastErrorMessage: string | null = null;
  for (
    let attempt = 1;
    attempt <= PRE_VEND_RESTORE_MAX_ATTEMPTS;
    attempt += 1
  ) {
    const { error } = await supabase
      .from('vtu_transactions')
      .update({
        error_message: errorMessage,
        metadata: {
          ...(row.metadata ?? {}),
          preVendInterruptedAt: new Date().toISOString(),
        },
        status: 'pending',
      })
      .eq('id', row.id)
      .eq('status', 'processing');
    if (!error) {
      return;
    }
    lastErrorMessage = error.message;
    if (attempt < PRE_VEND_RESTORE_MAX_ATTEMPTS) {
      const delayMs =
        PRE_VEND_RESTORE_BACKOFF_MS[
          Math.min(attempt - 1, PRE_VEND_RESTORE_BACKOFF_MS.length - 1)
        ];
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  console.error('Failed to restore interrupted pre-vend VTU row:', {
    attempts: PRE_VEND_RESTORE_MAX_ATTEMPTS,
    error: lastErrorMessage,
    transactionId: row.id,
  });
}
