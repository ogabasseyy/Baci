import { getProductBlogCacheRuntimeConfig } from '@/lib/product-blog-cache-runtime-config';
import {
  buildStorefrontProductPurgeUrls,
  countDistinctProductPurgeEntries,
  PURGE_WHOLE_STOREFRONT_THRESHOLD,
  PURGE_WHOLE_STOREFRONT_URL_THRESHOLD,
  type StorefrontProductPurgeEntry,
} from '@/lib/storefront-product-purge-urls';

const REMOTE_EDGE_PURGE_TIMEOUT_MS = 5_000;

export interface DelegateStorefrontEdgePurgeInput {
  merchantId: string;
  merchantSlug: string;
  entries: readonly StorefrontProductPurgeEntry[];
  productSlugs: readonly string[];
  blogPostSlugs: readonly string[];
  purgeWholeStorefront: boolean;
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
  productSlugs,
  blogPostSlugs,
  purgeWholeStorefront,
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
    if (
      (parsedBase.protocol !== 'https:' && parsedBase.protocol !== 'http:') ||
      parsedBase.username ||
      parsedBase.password
    ) {
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
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
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
        ...(normalizedBlogPostSlugs.length > 0
          ? { blogPostSlugs: normalizedBlogPostSlugs }
          : {}),
        ...(useWholeStorefront
          ? { purgeWholeStorefront: true }
          : {
              products: entries.map((entry) => ({
                slug: entry.slug,
                ...(entry.categorySegment
                  ? { categorySlug: entry.categorySegment }
                  : {}),
              })),
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
    const payload = (await response.json().catch(() => null)) as {
      edgePurged?: unknown;
    } | null;
    if (payload?.edgePurged !== true) {
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
