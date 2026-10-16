/**
 * Render an RPC-provided activity/history instant for display. A
 * malformed or missing value falls back to a placeholder instead of
 * the raw 'Invalid Date' string. The locale and business-region
 * time zone are explicit so server and client render the identical
 * string: a bare toLocaleString hydrates in the runtime time zone
 * and mismatches for merchants outside the server zone.
 */
export function formatRefundActivityInstant(value: unknown): string {
  const time =
    typeof value === 'string' || typeof value === 'number'
      ? new Date(value).getTime()
      : Number.NaN;
  if (Number.isNaN(time)) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Lagos',
  }).format(new Date(time));
}
