/**
 * User-facing error classifier for VTU checkout routes. The catch-all
 * must not echo raw errors (PostgREST fragments can leak Supabase URL /
 * schema details), so only whitelisted messages pass through with their
 * text; everything else becomes a generic 500. Extracted from the
 * wallet-only route to keep that file under the 300-line budget.
 */
/**
 * Fixed customer-safe validation failure. Prepare used to throw
 * `Monnify validation failed: ${verification.message}` with the
 * provider's response text interpolated, and a prefix pattern
 * passed the whole string through as a 400 — provider bodies in
 * responses, against the wallet-only exception (Codex R90 P1).
 * Validation failures now throw exactly this string (exact Set
 * match, no pattern), so provider diagnostics can never ride the
 * message. The remaining patterns interpolate REQUEST values only
 * (amounts, catalog codes, network names), never provider bodies.
 */
export const MONNIFY_VALIDATION_FAILED_MESSAGE =
  'Monnify validation failed. Please verify the details and try again.';

const USER_FACING_CHECKOUT_ERRORS = new Set([
  'Biller name or provider key is required for bill payment',
  'Customer account not found for this storefront',
  'Failed to initiate purchase',
  'Invalid customer phone number',
  'Invalid phone number',
  MONNIFY_VALIDATION_FAILED_MESSAGE,
  'Merchant not found',
  'Monnify validation reference is required but missing',
  'VTU is not enabled for this merchant',
]);

const USER_FACING_CHECKOUT_ERROR_PATTERNS = [
  /purchases are not enabled$/,
  /^Amount for .+ must be exactly /,
  /^Data bundle (?:amount changed|not found)/,
  /^Invalid network provider/,
  /^Maximum amount for .+ is /,
  /^Minimum amount for .+ is /,
  /^Monnify airtime biller not found for /,
  /^Monnify airtime product not found for /,
  /^Monnify product not found for /,
  /^Multiple data bundles match/,
];

export function isUserFacingCheckoutError(message: string): boolean {
  return (
    USER_FACING_CHECKOUT_ERRORS.has(message) ||
    USER_FACING_CHECKOUT_ERROR_PATTERNS.some((pattern) => pattern.test(message))
  );
}
