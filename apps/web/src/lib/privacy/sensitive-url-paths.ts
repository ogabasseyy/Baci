/**
 * Path prefixes whose NEXT segment is a capability token (anyone holding the
 * link can act on it). Shopper-facing routes only: today that is the receipt
 * claim link `/receipts/claim/<token>`. The segment is replaced with
 * `PATH_TOKEN_PLACEHOLDER` in every URL sent to a vendor; it works for bare
 * paths and absolute URLs, with or without a storefront prefix.
 */
export const SENSITIVE_PATH_PREFIXES = ['/receipts/claim/'] as const;

export const PATH_TOKEN_PLACEHOLDER = '[redacted]';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Source of the regex that matches a prefix and the token segment after it. */
export const SENSITIVE_PATH_REGEX_SOURCE = `(${SENSITIVE_PATH_PREFIXES.map(
  escapeRegExp
).join('|')})[^/?#]+`;

/** Replaces the token segment of any sensitive path prefix in `url`. */
export function redactPathTokens(url: string): string {
  return url.replace(
    new RegExp(SENSITIVE_PATH_REGEX_SOURCE, 'gi'),
    `$1${PATH_TOKEN_PLACEHOLDER}`
  );
}
