/**
 * Normalize a currency code for evidence comparison: legacy rows may
 * pad the value (` NGN `), and providers return strict uppercase.
 * Mirrors the record_verified_paystack_cancellation_refund_v1 SQL
 * checks (whitespace-trimmed, uppercased); missing or blank values
 * normalize to '' and never match a real code.
 */
export function normalizeCurrencyCode(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toUpperCase();
}
