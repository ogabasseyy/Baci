import type { PublicDomainResolution } from './domain-cache-database';

/** Undefined means unavailable, not authoritative absence: never negative-cache it. */
export function cacheableDomainResolution(
  result: PublicDomainResolution
): string | null | undefined {
  if (result.outcome === 'resolved') return result.value;
  if (result.outcome === 'not-found') return null;
  return undefined;
}
