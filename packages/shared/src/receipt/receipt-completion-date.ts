export interface ReceiptCompletionCandidate {
  created_at?: string | null;
  status?: string | null;
  transaction_type?: string | null;
}

/**
 * Canonical paid-receipt date: the newest settled payment. Settled payment
 * rows only, newest first, null timestamps last. A missing list means the
 * order has no completion transaction, so it selects null. Shared by the
 * web sender/download paths and the mobile list/preview so every surface
 * dates receipts like the emailed PDF.
 *
 * Defensive inputs fail closed: null entries and unparseable timestamps
 * are dropped before comparison (a NaN comparator is
 * implementation-defined), and corrupt rows must never crash a render.
 */
export function selectReceiptCompletionDate(
  rows: readonly unknown[] | undefined | null
): string | null {
  let newest: string | null = null;
  let newestTime = Number.NEGATIVE_INFINITY;
  for (const row of rows ?? []) {
    if (row == null || typeof row !== 'object') continue;
    const txn = row as ReceiptCompletionCandidate;
    if (txn.transaction_type !== 'payment') continue;
    if (txn.status !== 'completed' && txn.status !== 'success') continue;
    if (typeof txn.created_at !== 'string') continue;
    const time = Date.parse(txn.created_at);
    if (!Number.isFinite(time)) continue;
    if (time > newestTime) {
      newestTime = time;
      newest = txn.created_at;
    }
  }
  return newest;
}
