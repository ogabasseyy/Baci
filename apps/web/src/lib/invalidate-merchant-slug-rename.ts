import { after } from 'next/server';
import {
  revalidateBlogFeed,
  revalidateDomains,
  revalidateMerchant,
  revalidateMerchantFeed,
  revalidateMerchantSlugLookup,
  revalidatePageConfig,
  revalidateStorefrontProductsSlugCache,
} from '@/lib/cache-revalidation';
import {
  invalidateForwardDomainCacheForSlug,
  invalidateReverseDomainCacheForSlug,
} from '@/lib/domain-cache-simple';
import { triggerDomainEdgeConfigSync } from '@/lib/edge-config-sync';
import { logger } from '@/lib/logger';
import { invalidateAliasCacheForSlug } from '@/lib/slug-alias-cache';

export interface InvalidateMerchantSlugRenameInput {
  merchantId: string;
  finalSlug: string;
  retiredSlug?: string | null;
}

/**
 * Busts all Next.js cache tags, in-process domain/alias caches, and schedules
 * the Vercel Edge Config resync backstop after a successful `rename_merchant_slug`
 * RPC. Shared by POST /api/merchant/rename-slug and onboarding slug recovery.
 */
export function invalidateMerchantSlugRename({
  merchantId,
  finalSlug,
  retiredSlug,
}: InvalidateMerchantSlugRenameInput): void {
  revalidateMerchant(merchantId, finalSlug);
  revalidateDomains();
  revalidatePageConfig(merchantId);
  revalidateMerchantFeed(merchantId);
  revalidateBlogFeed();
  if (retiredSlug && retiredSlug !== finalSlug) {
    revalidateMerchantSlugLookup(retiredSlug);
    invalidateReverseDomainCacheForSlug(retiredSlug);
    invalidateForwardDomainCacheForSlug(retiredSlug);
    invalidateAliasCacheForSlug(retiredSlug);
  }
  revalidateMerchantSlugLookup(finalSlug);
  revalidateStorefrontProductsSlugCache();
  invalidateForwardDomainCacheForSlug(finalSlug);
  invalidateAliasCacheForSlug(finalSlug);

  try {
    after(() => triggerDomainEdgeConfigSync());
  } catch {
    void triggerDomainEdgeConfigSync().catch((error: unknown) => {
      logger.warn({
        message: 'Edge Config sync fallback failed after slug rename',
        merchantId,
        finalSlug,
        error,
      });
    });
  }
}
