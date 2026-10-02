/**
 * Normalize a stored gateway name for comparison: legacy rows may pad
 * or re-case the value (` Paystack `). Mirrors the aggregate coverage
 * SQL gates (whitespace-trimmed, uppercased); missing or blank values
 * normalize to '' and never match a real gateway.
 */
export function normalizePaymentGateway(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toUpperCase();
}
