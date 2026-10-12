/**
 * User-facing error classifier for VTU checkout routes. The catch-all
 * must not echo raw errors (PostgREST fragments can leak Supabase URL /
 * schema details), so only whitelisted messages pass through with their
 * text; everything else becomes a generic 500. Extracted from the
 * wallet-only route to keep that file under the 300-line budget.
 */
const USER_FACING_CHECKOUT_ERRORS = new Set([
  'Biller name or provider key is required for bill payment',
  'Customer account not found for this storefront',
  'Failed to initiate purchase',
  'Invalid customer phone number',
  'Invalid phone number',
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
  /^Monnify validation failed: /,
  /^Multiple data bundles match/,
];

export function isUserFacingCheckoutError(message: string): boolean {
  return (
    USER_FACING_CHECKOUT_ERRORS.has(message) ||
    USER_FACING_CHECKOUT_ERROR_PATTERNS.some((pattern) => pattern.test(message))
  );
}
