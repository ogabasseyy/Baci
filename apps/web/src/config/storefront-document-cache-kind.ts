import type { StorefrontDocumentCacheKind } from './storefront-cdn-cache-control';

/** Choose freshness only after the proxy's method, auth and URL safety checks. */
export function selectStorefrontDocumentCacheKind({
  cacheable,
  hasPurgePolicy,
  isPdp,
  durablePdpPurge,
  canUseLongCache,
}: {
  cacheable: boolean;
  hasPurgePolicy: boolean;
  isPdp: boolean;
  durablePdpPurge: boolean;
  canUseLongCache: boolean;
}): StorefrontDocumentCacheKind {
  if (!cacheable) return 'non-cacheable';
  if (!hasPurgePolicy) return 'cacheable-vercel-only';
  if (isPdp) {
    return durablePdpPurge ? 'cacheable-pdp' : 'cacheable-self-healing';
  }
  return canUseLongCache ? 'cacheable' : 'cacheable-self-healing';
}
