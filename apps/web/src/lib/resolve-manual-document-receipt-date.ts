export interface ReceiptCompletionCandidate {
  created_at?: string | null;
  status?: string | null;
  transaction_type?: string | null;
}

/**
 * In-memory twin of the lookup above for callers that already hold the
 * customer-visible transaction rows (the customer client cannot read the
 * merchant-only ledger directly). Same semantics: settled payment rows
 * only, newest first, null timestamps last. A missing list means the
 * order has no completion transaction, so it selects null; lookup
 * failures must 500 at the caller, never degrade to null here. The
 * result is shared with the emailed PDF and account download.
 */
export function selectReceiptCompletionDate(
  rows: readonly ReceiptCompletionCandidate[] | undefined
): string | null {
  let newest: string | null = null;
  let newestTime = Number.NEGATIVE_INFINITY;
  for (const row of rows ?? []) {
    if (row.transaction_type !== 'payment') continue;
    if (row.status !== 'completed' && row.status !== 'success') continue;
    if (typeof row.created_at !== 'string') continue;
    const time = Date.parse(row.created_at);
    if (!Number.isFinite(time)) continue;
    if (time > newestTime) {
      newestTime = time;
      newest = row.created_at;
    }
  }
  return newest;
}
