import {
  CLOUDFLARE_PURGE_DEFAULT_TIMEOUT_MS,
  CLOUDFLARE_PURGE_MAX_URLS_PER_BATCH,
} from '@/lib/cloudflare-purge';
import { getProductBlogCacheRuntimeConfig } from '@/lib/product-blog-cache-runtime-config';
import {
  buildStorefrontProductPurgeUrls,
  countDistinctProductPurgeEntries,
  PURGE_WHOLE_STOREFRONT_THRESHOLD,
  PURGE_WHOLE_STOREFRONT_URL_THRESHOLD,
  type StorefrontProductPurgeEntry,
} from '@/lib/storefront-product-purge-urls';

const MAX_CONFIRMED_PURGE_BATCHES = Math.ceil(
  PURGE_WHOLE_STOREFRONT_URL_THRESHOLD / CLOUDFLARE_PURGE_MAX_URLS_PER_BATCH
);
const REMOTE_EDGE_PURGE_OVERHEAD_MS = 5_000;
const REMOTE_EDGE_PURGE_TIMEOUT_MS =
  MAX_CONFIRMED_PURGE_BATCHES * CLOUDFLARE_PURGE_DEFAULT_TIMEOUT_MS +
  REMOTE_EDGE_PURGE_OVERHEAD_MS;
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function isAllowedBaseOrigin(parsedBase: URL): boolean {
  if (parsedBase.username || parsedBase.password) {
    return false;
  }
  if (parsedBase.protocol === 'https:') {
    return true;
  }
  return (
    parsedBase.protocol === 'http:' &&
    LOOPBACK_HOSTNAMES.has(parsedBase.hostname.toLowerCase())
  );
}

export interface DelegateStorefrontEdgePurgeInput {
  merchantId: string;
  merchantSlug: string;
  entries: readonly StorefrontProductPurgeEntry[];
  productIds?: readonly string[];
  authoritativeSlugsById?: ReadonlyMap<string, string>;
  productSlugs: readonly string[];
  blogPostSlugs: readonly string[];
  purgeWholeStorefront: boolean;
  slugsUnchanged?: boolean;
}

/**
 * Delegates confirmed Cloudflare edge eviction from standalone VPS workers
 * (which do not hold Cloudflare credentials) to `POST /api/internal/revalidate-products`
 * on the web deployment, requiring explicit `edgePurged === true` confirmation.
 */
export async function delegateStorefrontEdgePurge({
  merchantId,
  merchantSlug,
  entries,
  productIds = [],
  authoritativeSlugsById,
  productSlugs,
  blogPostSlugs,
  purgeWholeStorefront,
  slugsUnchanged = false,
}: DelegateStorefrontEdgePurgeInput): Promise<boolean> {
  let secret: string | undefined;
  let baseUrl: string | undefined;
  try {
    const runtimeConfig = getProductBlogCacheRuntimeConfig();
    secret = runtimeConfig.secret;
    baseUrl = runtimeConfig.baseUrl;
  } catch (error) {
    console.warn('Skipped delegated edge purge: runtime config read failed', {
      merchantId,
      error,
    });
    return false;
  }
  if (!secret || !baseUrl) {
    console.warn(
      'Skipped delegated edge purge: internal revalidation config is incomplete',
      { merchantId, hasSecret: Boolean(secret), hasBaseUrl: Boolean(baseUrl) }
    );
    return false;
  }

  let endpoint: URL;
  try {
    const parsedBase = new URL(baseUrl);
    if (!isAllowedBaseOrigin(parsedBase)) {
      console.warn('Skipped delegated edge purge: invalid baseUrl', {
        merchantId,
      });
      return false;
    }
    endpoint = new URL('/api/internal/revalidate-products', parsedBase.origin);
  } catch {
    console.warn('Skipped delegated edge purge: malformed baseUrl', {
      merchantId,
    });
    return false;
  }

  const normalizedBlogPostSlugs = Array.from(
    new Set(
      blogPostSlugs.map((slug) => slug.trim()).filter((slug) => slug.length > 0)
    )
  );
  const useWholeStorefront =
    purgeWholeStorefront ||
    countDistinctProductPurgeEntries(entries) >
      PURGE_WHOLE_STOREFRONT_THRESHOLD ||
    buildStorefrontProductPurgeUrls(
      [merchantSlug],
      entries,
      normalizedBlogPostSlugs
    ).length > PURGE_WHOLE_STOREFRONT_URL_THRESHOLD;
  const normalizedProductIds = Array.from(
    new Set(productIds.map((id) => id.trim()).filter((id) => id.length > 0))
  );
  const toEntryPayload = (entry: StorefrontProductPurgeEntry) => ({
    slug: entry.slug,
    ...(entry.categorySegment ? { categorySlug: entry.categorySegment } : {}),
  });
  let canOmitMerchantWidePdpDetails = false;
  let delegatedProducts: Record<string, unknown>[];

  if (normalizedProductIds.length > 0 && authoritativeSlugsById) {
    const matchedEntryIndices = new Set<number>();
    let allIdsMatched = true;
    const idProducts = normalizedProductIds.map((id) => {
      const authoritativeSlug = authoritativeSlugsById.get(id)?.trim();
      const matchedIndex = authoritativeSlug
        ? entries.findIndex((entry) => entry.slug === authoritativeSlug)
        : -1;
      if (matchedIndex === -1) {
        allIdsMatched = false;
        return authoritativeSlug
          ? { id, slug: authoritativeSlug, previousSlug: null }
          : { id };
      }
      matchedEntryIndices.add(matchedIndex);
      return {
        id,
        ...toEntryPayload(entries[matchedIndex]),
        previousSlug: null,
      };
    });
    const unmatchedEntries = entries.filter(
      (_, index) => !matchedEntryIndices.has(index)
    );
    delegatedProducts = [
      ...idProducts,
      ...unmatchedEntries.map(toEntryPayload),
    ];
    canOmitMerchantWidePdpDetails =
      productSlugs.length > 0 && allIdsMatched && unmatchedEntries.length === 0;
  } else if (normalizedProductIds.length === 1 && entries.length === 1) {
    delegatedProducts = [
      {
        id: normalizedProductIds[0],
        ...toEntryPayload(entries[0]),
        previousSlug: null,
      },
    ];
    canOmitMerchantWidePdpDetails = productSlugs.length > 0;
  } else if (normalizedProductIds.length > 0) {
    delegatedProducts = [
      ...normalizedProductIds.map((id) => ({ id })),
      ...entries.map(toEntryPayload),
    ];
  } else {
    delegatedProducts = entries.map(toEntryPayload);
  }
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        merchantId,
        merchantSlug,
        expireProductBlogCache: true,
        confirmEdgeEviction: true,
        ...(productSlugs.length > 0 ? { productSlugs } : {}),
        ...(useWholeStorefront
          ? { purgeWholeStorefront: true }
          : {
              ...(canOmitMerchantWidePdpDetails
                ? {
                    omitMerchantWidePdpDetails: true,
                    ...(slugsUnchanged ? { slugsUnchanged: true } : {}),
                  }
                : {}),
              ...(normalizedBlogPostSlugs.length > 0
                ? { blogPostSlugs: normalizedBlogPostSlugs }
                : {}),
              products: delegatedProducts,
            }),
      }),
      signal: AbortSignal.timeout(REMOTE_EDGE_PURGE_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn('Delegated edge purge returned non-2xx status', {
        merchantId,
        status: response.status,
      });
      return false;
    }
    const payload: unknown = await response.json().catch(() => null);
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('edgePurged' in payload) ||
      payload.edgePurged !== true
    ) {
      console.warn('Delegated edge purge was not confirmed by web route', {
        merchantId,
      });
      return false;
    }
    return true;
  } catch (error) {
    console.warn('Delegated edge purge request failed', {
      merchantId,
      error,
    });
    return false;
  }
}
