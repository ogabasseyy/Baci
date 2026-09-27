import type { PostgrestError } from '@supabase/supabase-js';
import type { MetadataRoute } from 'next';
import { getCachedCategoryProductCounts } from '@/lib/cached-category-product-counts';
import {
  getCachedCategoryPageData,
  getMerchantByIdentifier,
} from '@/lib/cached-data';
import { normalizeProductKeySpecs } from '@/lib/product-key-specs-normalize';
import { isRawDbProductRecord, type RawDbProduct } from '@/lib/raw-db-product';
import { isRepairsCatalogEnabled } from '@/lib/repairs/repairs-feature';
import { escapeHtml } from '@/lib/sanitize-core';
import { buildRequestScopedStoreUrl } from '@/lib/store-url';
import { buildCommercialSupportDiscoveryLinks } from '@/lib/storefront-compare/build-compare-discovery-links';
import {
  resolveMerchantContextIdentifier,
  resolveRouteIdentifier,
} from '@/lib/storefront-route-identifier';
import { buildProductSeoDecision } from '@/lib/storefront-seo/build-product-seo-decision';
import { isSeoSitemapEligible } from '@/lib/storefront-seo/is-seo-sitemap-eligible';
import { isStorefrontSitemapPublished } from '@/lib/storefront-seo/is-storefront-sitemap-published';
import { toProductIndexingFacts } from '@/lib/storefront-seo/to-product-indexing-facts';
import { createAnonClient } from '@/lib/supabase/anon';
import { getBrandAuthoritySitemapEntries } from './brand-authority-sitemap';
import { buildCategorySitemapEntries } from './build-category-sitemap-entries';
import {
  buildProductSitemapEntry,
  type ProductWithCategory,
} from './build-product-sitemap-entry';
import { getGamingGraphicsHubSitemapEntries } from './gaming-graphics-hub-sitemap';
import { getCommercialSupportCategorySitemapEntries } from './get-commercial-support-category-sitemap-entries';
import { getStaticSitemapEntries } from './get-static-sitemap-entries';
import { getTrustPolicySitemapEntries } from './get-trust-policy-sitemap-entries';

export { getStaticSitemapEntries } from './get-static-sitemap-entries';
export { getTrustPolicySitemapEntries } from './get-trust-policy-sitemap-entries';

const SITEMAP_QUERY_PAGE_SIZE = 1000;
// Sitemap spec caps a single file at 50,000 URLs. Leave headroom so the
// products child sitemap stays comfortably under the limit.
const SITEMAP_MAX_PRODUCT_URLS = 45_000;
export const SITEMAP_MAX_COMMERCIAL_SUPPORT_URLS = 45_000;
const SITEMAP_COMMERCIAL_SUPPORT_PRODUCTS_PER_CATEGORY_LIMIT = 150;
export const SITEMAP_COMMERCIAL_SUPPORT_CATEGORY_CONCURRENCY = 4;
export interface StorefrontSitemapContext {
  merchant: NonNullable<Awaited<ReturnType<typeof getMerchantByIdentifier>>>;
  storeUrl: string;
  supabase: ReturnType<typeof createAnonClient>;
}

export type StorefrontSitemapContextResult =
  | { context: StorefrontSitemapContext; status: 'found' }
  | { status: 'not-found' | 'unavailable' };

export async function resolveStorefrontSitemapContextResult(
  headersList: Headers,
  routeIdentifierOverride?: string | null,
  request?: Request
): Promise<StorefrontSitemapContextResult> {
  const rawIdentifiers: string[] = [];
  const requestHeaders = request ? new Headers(request.headers) : null;

  // 1. Request headers (proxy headers set by middleware)
  if (requestHeaders) {
    try {
      const requestRouteIdentifier =
        resolveMerchantContextIdentifier(requestHeaders);
      if (requestRouteIdentifier) {
        rawIdentifiers.push(requestRouteIdentifier);
      }
    } catch {
      // ignore
    }
  }

  // 2. Request host
  let requestHostname: string | null = null;
  if (request) {
    try {
      const url = new URL(request.url);
      const host = url.hostname.toLowerCase();
      requestHostname = host;
      const normalizedHost = host.replace(/^www\./, '');
      const rootDomain = (
        process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'usebaci.com'
      ).toLowerCase();

      if (
        normalizedHost !== 'localhost' &&
        normalizedHost !== '127.0.0.1' &&
        normalizedHost !== rootDomain
      ) {
        if (normalizedHost.endsWith(`.${rootDomain}`)) {
          const sub = normalizedHost.slice(0, -(rootDomain.length + 1));
          if (sub) rawIdentifiers.push(sub);
        } else {
          rawIdentifiers.push(normalizedHost);
          if (host.startsWith('www.')) {
            rawIdentifiers.push(host);
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // 3. Next.js headers
  const headerRouteIdentifier = resolveRouteIdentifier(headersList);
  if (headerRouteIdentifier) {
    rawIdentifiers.push(headerRouteIdentifier);
  }

  // 4. Route params override
  const routeIdentifierOverrideValue =
    routeIdentifierOverride?.trim().toLowerCase() || '';
  if (routeIdentifierOverrideValue) {
    rawIdentifiers.push(routeIdentifierOverrideValue);
  }

  const routeIdentifiers = rawIdentifiers.filter(
    (value, index, values): value is string =>
      Boolean(value && values.indexOf(value) === index)
  );

  let merchant = null;
  let hadLookupError = false;
  for (const routeIdentifier of routeIdentifiers) {
    try {
      merchant = await getMerchantByIdentifier(routeIdentifier);
    } catch (error) {
      hadLookupError = true;
      console.warn('Failed to resolve sitemap merchant', {
        routeIdentifier,
        error,
      });
      continue;
    }

    if (merchant) {
      break;
    }
  }

  if (!merchant) {
    const SAFE_LOG_HEADERS = [
      'host',
      'x-forwarded-host',
      'x-merchant-slug',
      'x-custom-domain',
      'x-merchant-domain',
    ];
    const safeHeaders = request
      ? Object.fromEntries(
          [...request.headers.entries()].filter(([k]) =>
            SAFE_LOG_HEADERS.includes(k.toLowerCase())
          )
        )
      : null;
    const log = hadLookupError ? console.error : console.warn;
    log('storefront sitemap: unresolved context', {
      candidates: rawIdentifiers,
      hosts: requestHostname ? [requestHostname] : [],
      safeHeaders,
    });
    return { status: hadLookupError ? 'unavailable' : 'not-found' };
  }

  const storeUrlHeaders = requestHeaders ?? headersList;

  return {
    status: 'found',
    context: {
      merchant,
      storeUrl: buildRequestScopedStoreUrl(merchant, storeUrlHeaders),
      supabase: createAnonClient(),
    },
  };
}

export async function resolveStorefrontSitemapContext(
  headersList: Headers,
  routeIdentifierOverride?: string | null,
  request?: Request
): Promise<StorefrontSitemapContext | null> {
  const result = await resolveStorefrontSitemapContextResult(
    headersList,
    routeIdentifierOverride,
    request
  );

  return result.status === 'found' ? result.context : null;
}

export function getStaticAndTrustSitemapEntries(
  context: StorefrontSitemapContext
): MetadataRoute.Sitemap {
  return [
    ...getStaticSitemapEntries(context),
    ...getTrustPolicySitemapEntries(context),
  ];
}

export async function getProductSitemapEntries({
  supabase,
  merchant,
  storeUrl,
}: StorefrontSitemapContext): Promise<MetadataRoute.Sitemap> {
  if (!isStorefrontSitemapPublished(merchant)) {
    return [];
  }

  const products: ProductWithCategory[] = [];
  let from = 0;

  while (products.length < SITEMAP_MAX_PRODUCT_URLS) {
    const remaining = SITEMAP_MAX_PRODUCT_URLS - products.length;
    const pageSize = Math.min(SITEMAP_QUERY_PAGE_SIZE, remaining);
    const { data, error } = (await supabase
      .from('products')
      .select(
        'id, name, slug, category, canonical_url, images, updated_at, category_id, categories:category_id(slug, is_active), product_categories:product_categories(category_id, categories(slug, is_active))'
      )
      .eq('merchant_id', merchant.id)
      .eq('status', 'active')
      .order('category_id', {
        ascending: true,
        referencedTable: 'product_categories',
      })
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1)) as {
      data: ProductWithCategory[] | null;
      error: PostgrestError | null;
    };

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      break;
    }

    products.push(...data);

    if (data.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  if (products.length === 0) {
    return [];
  }

  return products.flatMap((product) => {
    const entry = buildProductSitemapEntry({ product, storeUrl });
    const decision = buildProductSeoDecision(
      toProductIndexingFacts({
        isStorePublished: merchant.is_published,
        status: 'active',
        name: product.name,
        canonicalUrl: entry.url,
      })
    );

    return isSeoSitemapEligible(decision) ? [entry] : [];
  });
}

export async function getCategorySitemapEntries({
  supabase,
  merchant,
  storeUrl,
}: StorefrontSitemapContext): Promise<MetadataRoute.Sitemap> {
  if (!isStorefrontSitemapPublished(merchant)) {
    return [];
  }

  const { data: categories, error } = await supabase
    .from('categories')
    .select('id, slug, updated_at, is_active, parent_id')
    .eq('merchant_id', merchant.id);

  if (error) {
    throw error;
  }

  if (!categories) {
    throw new Error(`Failed to load category sitemap for ${merchant.id}`);
  }

  const activeCategories = categories.filter(
    (category) => category.is_active === true
  );
  if (activeCategories.length === 0) {
    return [];
  }
  const categoryCounts = await getCachedCategoryProductCounts(
    merchant.id,
    activeCategories
  );

  return buildCategorySitemapEntries({
    categories: activeCategories,
    categoryCounts,
    isStorePublished: merchant.is_published,
    storeUrl,
  });
}

export { getBrandAuthoritySitemapEntries } from './brand-authority-sitemap';

/**
 * Whether the repairs catalogue is publicly enabled for this merchant. The
 * `/repairs` index and per-device pages only render (and should only be
 * listed) when the electronics/gadgets business type + feature flag are on.
 */
function isRepairsCatalogEnabledForMerchant(
  merchant: StorefrontSitemapContext['merchant']
): boolean {
  const merchantWithFlags = merchant as {
    business_type?: string | null;
    feature_settings?: { repairs_catalog_enabled?: boolean } | null;
  };
  return isRepairsCatalogEnabled({
    businessType: merchantWithFlags.business_type,
    repairsCatalogEnabled:
      merchantWithFlags.feature_settings?.repairs_catalog_enabled,
  });
}

/**
 * Repairs child sitemap: the `/repairs` device picker plus one URL per active
 * repair device page. Only invoked when the repairs catalogue is enabled, so
 * every listed URL resolves. `slug` is the sole public-granted column read.
 */
export async function getRepairsSitemapEntries({
  supabase,
  merchant,
  storeUrl,
}: StorefrontSitemapContext): Promise<MetadataRoute.Sitemap> {
  if (!isStorefrontSitemapPublished(merchant)) {
    return [];
  }

  if (!isRepairsCatalogEnabledForMerchant(merchant)) {
    return [];
  }

  const { data, error } = await supabase
    .from('repair_devices')
    .select('slug')
    .eq('merchant_id', merchant.id)
    .eq('is_active', true)
    .order('slug', { ascending: true });

  if (error) {
    throw error;
  }

  const entries: MetadataRoute.Sitemap = [
    {
      url: `${storeUrl}/repairs`,
      changeFrequency: 'weekly',
      priority: 0.6,
    },
  ];

  for (const device of (data ?? []) as Array<{ slug: string | null }>) {
    const slug = device.slug?.trim();
    if (!slug) {
      continue;
    }
    entries.push({
      url: `${storeUrl}/repairs/${slug}`,
      changeFrequency: 'weekly',
      priority: 0.6,
    });
  }

  return entries;
}

function isCategoryWithSlug(category: unknown): category is { slug: string } {
  return (
    typeof category === 'object' &&
    category !== null &&
    'slug' in category &&
    typeof category.slug === 'string'
  );
}

function getRawProductCategorySlug(
  product: RawDbProduct,
  fallbackSlug: string
) {
  const rawDirectCategories: unknown[] = Array.isArray(product.categories)
    ? product.categories
    : product.categories
      ? [product.categories]
      : [];
  const directCategories = rawDirectCategories.filter(isCategoryWithSlug);
  const rawProductCategories: unknown[] =
    product.product_categories?.map((entry) => entry.categories) ?? [];
  const productCategories = rawProductCategories.filter(isCategoryWithSlug);
  const activeCategorySlug = [...directCategories, ...productCategories].find(
    (category) => category.slug === fallbackSlug
  )?.slug;
  const joinedCategorySlug =
    directCategories[0]?.slug || productCategories[0]?.slug;
  const categorySlug =
    activeCategorySlug ||
    joinedCategorySlug ||
    fallbackSlug ||
    product.category_slug;

  return categorySlug;
}

export async function getCommercialSupportSitemapEntries(
  context: StorefrontSitemapContext
): Promise<MetadataRoute.Sitemap> {
  if (!isStorefrontSitemapPublished(context.merchant)) {
    return [];
  }

  const categoryEntries = await getCommercialSupportCategorySitemapEntries({
    merchantId: context.merchant.id,
    storeUrl: context.storeUrl,
    supabase: context.supabase,
  });
  const commercialEntries: MetadataRoute.Sitemap = [];
  const seenCommercialUrls = new Set<string>();
  const graphicsHubEntries = await getGamingGraphicsHubSitemapEntries(context);

  for (const entry of graphicsHubEntries) {
    seenCommercialUrls.add(entry.url);
    commercialEntries.push(entry);
  }

  for (
    let index = 0;
    index < categoryEntries.length &&
    commercialEntries.length < SITEMAP_MAX_COMMERCIAL_SUPPORT_URLS;
    index += SITEMAP_COMMERCIAL_SUPPORT_CATEGORY_CONCURRENCY
  ) {
    const categoryBatch = categoryEntries.slice(
      index,
      index + SITEMAP_COMMERCIAL_SUPPORT_CATEGORY_CONCURRENCY
    );
    const batchEntries = await Promise.all(
      categoryBatch.map(async (entry) => {
        const categorySlug = entry.url.replace(`${context.storeUrl}/`, '');
        const categoryData = await getCachedCategoryPageData(
          context.merchant.id,
          categorySlug,
          context.merchant.slug,
          0,
          SITEMAP_COMMERCIAL_SUPPORT_PRODUCTS_PER_CATEGORY_LIMIT
        );

        if (!categoryData || categoryData.isCollection) {
          return [];
        }

        const products = (categoryData.products ?? [])
          .filter(isRawDbProductRecord)
          .map((product) => ({
            slug: product.slug || product.id,
            name: product.name,
            brand: product.brand,
            price: product.price,
            category_slug: getRawProductCategorySlug(product, categorySlug),
            product_key_specs: normalizeProductKeySpecs(
              product.product_key_specs
            ),
          }));
        const links = buildCommercialSupportDiscoveryLinks({
          storeUrl: context.storeUrl,
          categorySlug,
          categoryName: categoryData.fallbackName || categorySlug,
          includeBrandCompareLinks: false,
          products,
        });

        return links.map((link) => ({
          url: link.href,
          lastModified:
            entry.lastModified instanceof Date ? entry.lastModified : undefined,
          changeFrequency: 'weekly' as const,
          priority: 0.6,
        }));
      })
    );

    for (const entries of batchEntries) {
      for (const entry of entries) {
        if (commercialEntries.length >= SITEMAP_MAX_COMMERCIAL_SUPPORT_URLS) {
          break;
        }

        if (seenCommercialUrls.has(entry.url)) {
          continue;
        }

        seenCommercialUrls.add(entry.url);
        commercialEntries.push(entry);
      }

      if (commercialEntries.length >= SITEMAP_MAX_COMMERCIAL_SUPPORT_URLS) {
        break;
      }
    }
  }

  return commercialEntries;
}

/**
 * Child sitemaps referenced by the root sitemap index. Each public URL is
 * rewritten by the proxy back into this route (or the dedicated blog
 * sitemap routes), so every child resolves on both custom domains and
 * platform subdomains.
 */
export function getSitemapIndexLinks(
  context: StorefrontSitemapContext
): string[] {
  const { merchant, storeUrl } = context;
  if (!isStorefrontSitemapPublished(merchant)) {
    return [];
  }

  const links = [
    `${storeUrl}/sitemap/static.xml`,
    `${storeUrl}/sitemap/products.xml`,
    `${storeUrl}/sitemap/categories.xml`,
    `${storeUrl}/sitemap/brand-authority.xml`,
    `${storeUrl}/sitemap/commercial-support.xml`,
  ];

  if (isRepairsCatalogEnabledForMerchant(merchant)) {
    links.push(`${storeUrl}/sitemap/repairs.xml`);
  }

  // The merchant snapshot already carries feature_settings; no second feature
  // lookup (and no failure mode for it) is needed on the sitemap index path.
  const blogEnabled = Boolean(merchant.feature_settings?.blog_enabled);

  if (blogEnabled) {
    links.push(
      `${storeUrl}/blog/sitemap.xml`,
      `${storeUrl}/blog/news-sitemap.xml`
    );
  }

  return links;
}

export function getNamedSitemapEntries(
  context: StorefrontSitemapContext,
  id: string
): MetadataRoute.Sitemap | Promise<MetadataRoute.Sitemap> {
  if (!isStorefrontSitemapPublished(context.merchant)) {
    return [];
  }

  switch (id) {
    case 'static':
      return getStaticAndTrustSitemapEntries(context);
    case 'products':
      return getProductSitemapEntries(context);
    case 'categories':
      return getCategorySitemapEntries(context);
    case 'brand-authority':
      return getBrandAuthoritySitemapEntries(context);
    case 'commercial-support':
      return getCommercialSupportSitemapEntries(context);
    case 'repairs':
      return getRepairsSitemapEntries(context);
    default:
      return [];
  }
}

export function serializeSitemap(entries: MetadataRoute.Sitemap): string {
  const hasImages = entries.some(
    (entry) => Array.isArray(entry.images) && entry.images.length > 0
  );
  const imageNamespace = hasImages
    ? ' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"'
    : '';

  const body = entries
    .map((entry) => {
      const lastModified =
        typeof entry.lastModified === 'string'
          ? entry.lastModified
          : entry.lastModified?.toISOString();
      const images = (entry.images || [])
        .map(
          (image) =>
            `<image:image><image:loc>${escapeHtml(image)}</image:loc></image:image>`
        )
        .join('');

      return (
        '<url>' +
        `<loc>${escapeHtml(entry.url)}</loc>` +
        (lastModified ? `<lastmod>${lastModified}</lastmod>` : '') +
        (entry.changeFrequency
          ? `<changefreq>${entry.changeFrequency}</changefreq>`
          : '') +
        (typeof entry.priority === 'number'
          ? `<priority>${entry.priority}</priority>`
          : '') +
        images +
        '</url>'
      );
    })
    .join('');

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${imageNamespace}>${body}</urlset>`
  );
}

// Index entries intentionally carry no <lastmod>: merchant.updated_at does
// not track catalog changes, and an inaccurate value teaches Google to
// ignore lastmod across the site.
export function serializeSitemapIndex(links: string[]): string {
  const body = links
    .map((link) => `<sitemap><loc>${escapeHtml(link)}</loc></sitemap>`)
    .join('');

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</sitemapindex>`
  );
}

export function createSitemapResponse(
  entries: MetadataRoute.Sitemap
): Response {
  return new Response(serializeSitemap(entries), {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}

export function createSitemapIndexResponse(links: string[]): Response {
  return new Response(serializeSitemapIndex(links), {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}

export function createSitemapUnavailableResponse(): Response {
  return new Response(
    '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>',
    {
      status: 503,
      headers: {
        'content-type': 'application/xml; charset=utf-8',
        'cache-control': 'no-store',
        'retry-after': '300',
      },
    }
  );
}

export function createSitemapNotFoundResponse(): Response {
  return new Response(
    '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>',
    {
      status: 404,
      headers: {
        'content-type': 'application/xml; charset=utf-8',
        'cache-control': 'no-store',
      },
    }
  );
}
