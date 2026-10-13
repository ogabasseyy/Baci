import type { CacheInvalidationClaim } from '@/schemas/cache-invalidation-claim';

const SHARED_GENERATION_TARGET_KINDS = new Set<
  CacheInvalidationClaim['target_kind']
>(['storefront_hostname', 'storefront_slug']);

function canonicalizeCoverage(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/** Provider SingleFlight / cron skip key for a claimed invalidation row. */
export function cacheInvalidationPurgeCausalKey(
  claim: Pick<
    CacheInvalidationClaim,
    | 'generation'
    | 'merchant_id'
    | 'product_slugs'
    | 'related_identifiers'
    | 'target_id'
    | 'target_kind'
  >
): string {
  // Shared slug/hostname siblings may finish without repeating the full purge
  // only when their identifier and product-tag coverage matches. Legacy
  // pre-migration rows kept target-specific related_identifiers, so coverage
  // must be part of the key until those claims drain. Coverage arrays are
  // canonicalized so duplicate entries cannot partition otherwise identical rows.
  if (SHARED_GENERATION_TARGET_KINDS.has(claim.target_kind)) {
    return JSON.stringify([
      claim.merchant_id,
      claim.generation,
      canonicalizeCoverage(claim.related_identifiers),
      canonicalizeCoverage(claim.product_slugs),
    ]);
  }
  return JSON.stringify([
    claim.merchant_id,
    claim.target_kind,
    claim.target_id,
    claim.generation,
  ]);
}
