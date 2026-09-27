import { storefrontRouteSegments } from '@/config/storefront-route-segments';
import {
  buildHardStatusStorefrontResponse,
  isEligibleForHardStatusPreflight,
} from '@/lib/proxy/preflight-common';
import {
  getRouteType,
  getStorefrontContentSegments,
} from '@/lib/proxy/routing-policy';
import { createStorefrontComparePageHardStatusResolver } from '@/lib/storefront-compare-page-hard-status';

export const resolveStorefrontComparePageHardStatus =
  createStorefrontComparePageHardStatusResolver({
    isEligibleForHardStatusPreflight,
    getRouteType,
    getStorefrontContentSegments,
    nonCacheableStorefrontFirstSegments:
      storefrontRouteSegments.NON_CACHEABLE_STOREFRONT_FIRST_SEGMENTS,
    buildHardStatusStorefrontResponse,
  });
