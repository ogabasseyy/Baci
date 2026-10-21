/**
 * Serialize PDP redirect query parameters.
 *
 * Canonical redirects fix the path only: carrying the query string keeps a
 * saved match selection (variant/offer/base-match) alive across the
 * redirect. Array values append individually; undefined values are
 * dropped. Returns the bare serialized string (no leading '?').
 */
export function serializeRedirectSearchParams(
  searchParams: Record<string, string | string[] | undefined>
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue;
    for (const entry of Array.isArray(value) ? value : [value]) {
      query.append(key, entry);
    }
  }
  return query.toString();
}
