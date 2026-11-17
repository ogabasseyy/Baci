import {
  partitionSensitiveSearch,
  redactPathTokens,
} from './sensitive-url-params';

/**
 * Removes sensitive and redirect-style query params, path-embedded capability
 * tokens (`/receipts/claim/<token>`) and the fragment from a URL before it is sent
 * to an ad/analytics vendor. Works on absolute URLs and bare paths and returns
 * the same shape it was given. Input that cannot be split cleanly is cut at the
 * first `?` or `#`.
 */
export function sanitizeTrackingUrl(url: string): string {
  const withoutHash = redactPathTokens(url.split('#', 1)[0] ?? '');
  const queryStart = withoutHash.indexOf('?');
  if (queryStart === -1) return withoutHash;

  const base = withoutHash.slice(0, queryStart);
  try {
    const { publicSearch } = partitionSensitiveSearch(
      withoutHash.slice(queryStart + 1)
    );
    return publicSearch ? `${base}?${publicSearch}` : base;
  } catch {
    return base;
  }
}
