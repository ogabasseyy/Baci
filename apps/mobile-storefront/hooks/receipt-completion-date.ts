// Canonical paid-receipt date: the newest settled payment, mirroring web
// selectReceiptCompletionDate (same settled statuses, same max-pick), so the
// mobile list and preview date receipts like the emailed PDF and download.
// Null entries fail closed: corrupt rows must not crash the render, and
// unparseable timestamps are dropped before comparison (a NaN comparator
// is implementation-defined).

export function selectReceiptCompletionDate(
  rows: readonly unknown[] | undefined | null
): string | null {
  let newest: string | null = null;
  let newestTime = Number.NEGATIVE_INFINITY;
  for (const row of rows ?? []) {
    if (row == null || typeof row !== 'object') continue;
    const txn = row as {
      transaction_type?: unknown;
      status?: unknown;
      created_at?: unknown;
    };
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
