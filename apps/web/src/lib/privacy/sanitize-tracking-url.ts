import { trackingSafeSearch } from './sensitive-url-params';

/**
 * Removes sensitive and redirect-style query params and the fragment from a URL before it is sent
 * to an ad/analytics vendor. Works on absolute URLs and bare paths and returns
 * the same shape it was given. Input that cannot be split cleanly is cut at the
 * first `?` or `#`.
 */
export function sanitizeTrackingUrl(url: string): string {
  const withoutHash = url.split('#', 1)[0] ?? '';
  const queryStart = withoutHash.indexOf('?');
  if (queryStart === -1) return withoutHash;

  const base = withoutHash.slice(0, queryStart);
  try {
    const kept = trackingSafeSearch(withoutHash.slice(queryStart + 1));
    return kept ? `${base}?${kept}` : base;
  } catch {
    return base;
  }
}
