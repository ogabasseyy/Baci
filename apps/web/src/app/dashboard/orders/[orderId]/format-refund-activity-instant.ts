/**
 * Render an RPC-provided activity/history instant for display. A
 * malformed or missing value falls back to a placeholder instead of
 * the raw 'Invalid Date' string.
 */
export function formatRefundActivityInstant(value: unknown): string {
  const time =
    typeof value === 'string' || typeof value === 'number'
      ? new Date(value).getTime()
      : Number.NaN;
  if (Number.isNaN(time)) return 'Date unavailable';
  return new Date(time).toLocaleString();
}
