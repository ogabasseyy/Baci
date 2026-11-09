/**
 * Validates that a candidate SKU or ProductGroup ID is a single-token,
 * non-empty identifier within Google Merchant Center's 50-character bound
 * without whitespace, control characters, or URL path/query/fragment delimiters.
 */
export function isValidMerchantIdentifier(
  value: string | null | undefined
): value is string {
  return Boolean(
    value && Array.from(value).length <= 50 && !/[/\\?#\s\p{C}]/u.test(value)
  );
}
