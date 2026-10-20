/**
 * Reverse domain cache ownership (domain -> slug, including cached misses).
 * Split out of domain-cache-simple so that module stays under the 300-line
 * changed-runtime gate; the API proxy imports the sync unmapped check from
 * here without pulling the async resolver graph.
 */

export function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.+$/, '');
}

interface ReverseCacheEntry {
  slug: string | null;
  timestamp: number;
}

/** Shared with domain-cache-simple; exported so tests can seed entries. */
export const reverseDomainCache = new Map<string, ReverseCacheEntry>();

/**
 * Synchronous check for a recently observed unmapped custom domain.
 * Lets the API proxy reject repeat forged origins before rate limiting
 * so ten cross-origin form POSTs from a malicious page cannot burn the
 * visitor IP's hourly bucket. The freshness window is deliberately far
 * shorter than DB_CACHE_TTL: this read cannot consult Edge Config, so
 * a newly added merchant domain stays reachable within a minute even
 * if that exact origin 403'd moments before the mapping went live.
 */
export function isRecentlyUnmappedCustomDomain(
  domain: string,
  maxAgeMs: number = 60_000
): boolean {
  const cached = reverseDomainCache.get(normalizeDomain(domain));
  return (
    !!cached && cached.slug === null && Date.now() - cached.timestamp < maxAgeMs
  );
}
