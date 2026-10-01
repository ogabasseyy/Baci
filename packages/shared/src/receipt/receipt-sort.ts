/**
 * Receipt list ordering.
 *
 * Receipt lists display the manual-order document date first
 * (invoice_issue_date → transaction_date → created_at). Sorting must use the
 * same fallback, otherwise a backdated invoice renders under one date but is
 * filed among receipts from another.
 */

export interface ReceiptSortable {
  invoice_issue_date?: string | null;
  transaction_date?: string | null;
  created_at?: string | null;
}

function parseReceiptSortValue(value: string): number {
  // Date-only values are calendar dates with no time component; anchor them at
  // UTC noon so the sort key never shifts with the viewer's timezone.
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T12:00:00.000Z`
    : value;
  const timestamp = Date.parse(normalized);
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}

function selectReceiptSortTimestamp(order: ReceiptSortable): number {
  const value =
    order.invoice_issue_date || order.transaction_date || order.created_at;
  if (!value) return Number.NEGATIVE_INFINITY;
  return parseReceiptSortValue(value);
}

/** Newest display date first; orders without a parseable date sort last. */
export function compareReceiptListDesc(
  a: ReceiptSortable,
  b: ReceiptSortable
): number {
  const aTimestamp = selectReceiptSortTimestamp(a);
  const bTimestamp = selectReceiptSortTimestamp(b);
  if (aTimestamp === bTimestamp) return 0;
  return bTimestamp - aTimestamp;
}
