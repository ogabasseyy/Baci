import { resolveVariantSelectionParamResolution } from '@baci/shared/lib';
import { notFound, permanentRedirect, redirect } from 'next/navigation';
import { cache } from 'react';
import { STOREFRONT_METADATA_CACHE_BUCKET_QUERY_PARAM } from '@/config/storefront-metadata-cache-bots';
import {
  getCachedLegacyProductRedirectTarget,
  getCachedProductWithDetails,
  getRequestScopedMerchant,
  sanitizeLookupLogValue,
} from '@/lib/cached-data';
import type { Product } from '@/lib/products';
import { asRoute } from '@/lib/routes';
import { getProductUrl } from '@/lib/seo-utils';
import { evaluateStorefrontSlugSafety } from '@/lib/storefront-slug-safety';
import { isValidMerchantIdentifier } from '@/lib/validation';
import { buildProductRedirectPath } from './build-product-redirect-path';
import { mapDetailedCachedProductToProduct } from './detailed-product-mapper';
import type {
  PageProps,
  ProductPageResolution,
  ResolvedMerchant,
  ResolvedSearchParams,
} from './product-page-types';

interface ProductLookupResult {
  merchant: ResolvedMerchant;
  product: Product | null;
}

const LEGACY_SELECTION_PARAM_KEYS = new Set([
  'selectedoptions',
  'variant',
  'variantid',
  'variant_id',
]);

function normalizeSearchParamKey(key: string) {
  return key
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function appendSearchParamValue(
  params: URLSearchParams,
  key: string,
  value: string | string[] | undefined
) {
  if (typeof value === 'string') {
    params.append(key, value);
    return;
  }

  if (!Array.isArray(value)) {
    return;
  }

  for (const entry of value) {
    if (typeof entry === 'string') {
      params.append(key, entry);
    }
  }
}

function buildRedirectSearchParams(searchParams: ResolvedSearchParams) {
  const nextParams = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (
      normalizeSearchParamKey(key) ===
      STOREFRONT_METADATA_CACHE_BUCKET_QUERY_PARAM
    ) {
      // Middleware injects this as an internal cache key only. Never expose it
      // through public variant-cleanup redirects or crawlable canonical URLs.
      continue;
    }
    appendSearchParamValue(nextParams, key, value);
  }

  return nextParams;
}

function buildSelectionSafeRedirectPath(
  storeSlug: string,
  product: Product,
  searchParams: ResolvedSearchParams,
  recognizedParamKeys: string[]
) {
  const targetPath = buildProductRedirectPath(
    storeSlug,
    getProductUrl(product)
  );
  const nextParams = buildRedirectSearchParams(searchParams);
  const removableKeys = new Set(
    recognizedParamKeys.map((key) => normalizeSearchParamKey(key))
  );

  for (const key of Array.from(nextParams.keys())) {
    const normalizedKey = normalizeSearchParamKey(key);
    if (
      removableKeys.has(normalizedKey) ||
      LEGACY_SELECTION_PARAM_KEYS.has(normalizedKey)
    ) {
      nextParams.delete(key);
    }
  }

  const queryString = nextParams.toString();
  return queryString ? `${targetPath}?${queryString}` : targetPath;
}

export async function getProductCached(
  storeSlug: string,
  productSlug: string
): Promise<ProductLookupResult | null> {
  if (!isValidMerchantIdentifier(storeSlug)) {
    return null;
  }

  // Over-long / repeatedly-encoded bot slugs can never match a product; bail
  // before any `'use cache'`/Supabase lookup runs with an unbounded key.
  if (!evaluateStorefrontSlugSafety(productSlug).safe) {
    console.warn(
      'Skipped product route lookups for unsafe product slug:',
      sanitizeLookupLogValue(productSlug)
    );
    return null;
  }

  const safeStoreSlug = sanitizeLookupLogValue(storeSlug);
  const merchant = await getRequestScopedMerchant(storeSlug);
  if (!merchant) {
    console.warn(
      'Merchant not found for storefront product route:',
      safeStoreSlug
    );
    return null;
  }
  const detailedProduct = await getCachedProductWithDetails(
    merchant.id,
    productSlug
  );
  if (!detailedProduct) {
    console.warn('Product lookup miss', {
      merchantId: merchant.id,
      productSlug,
    });
    return { merchant, product: null };
  }

  return {
    merchant,
    product: mapDetailedCachedProductToProduct(detailedProduct, merchant.id),
  };
}

/**
 * Request-scoped product lookup via React cache().
 * Deduplicates getProductCached() calls within a single request — the PDP
 * route's generateMetadata and the page body's resolveProductPage() both
 * resolve the same product; only one lookup runs per unique
 * (storeSlug, productSlug) argument pair.
 */
export const getRequestScopedProduct = cache(
  (
    storeSlug: string,
    productSlug: string
  ): ReturnType<typeof getProductCached> => {
    return getProductCached(storeSlug, productSlug);
  }
);

// Returns the canonical redirect target if the URL is categorized but lives
// under /products/, else null. Pure — caller decides whether to throw a real
// redirect (page component) or emit noindex metadata (generateMetadata).
export function getCategorizedRedirectTarget(
  storeSlug: string,
  product: Product,
  searchParams?: ResolvedSearchParams
): string | null {
  const productPath = getProductUrl(product);
  if (productPath.startsWith('/products/')) {
    return null;
  }
  const targetPath = buildProductRedirectPath(storeSlug, productPath);
  // Only the path is wrong — the selection is valid, so the matched
  // option (variantId, condition) rides along instead of opening defaults.
  if (searchParams === undefined) {
    return targetPath;
  }
  const queryString = buildRedirectSearchParams(searchParams).toString();
  return queryString ? `${targetPath}?${queryString}` : targetPath;
}

// Returns the canonical redirect target when the URL's variant params are
// inconsistent (attribute-only, ambiguous, invalid id, zero-match). Pure —
// see getCategorizedRedirectTarget above for the rationale.
export function getInvalidVariantSelectionRedirectTarget(
  storeSlug: string,
  product: Product,
  searchParams: ResolvedSearchParams
): string | null {
  if (!product.variants || product.variants.length === 0) {
    return null;
  }

  const selectionResolution = resolveVariantSelectionParamResolution(
    product,
    searchParams
  );

  if (
    selectionResolution.type === 'attribute_only' ||
    selectionResolution.type === 'ambiguous' ||
    selectionResolution.type === 'invalid_variant_id' ||
    selectionResolution.type === 'zero_match'
  ) {
    return buildSelectionSafeRedirectPath(
      storeSlug,
      product,
      searchParams,
      selectionResolution.extracted.recognizedParamKeys
    );
  }

  return null;
}

async function getLegacyVariantProductRedirectPath(
  storeSlug: string,
  productSlug: string,
  merchant: ResolvedMerchant
): Promise<string | null> {
  const redirectTarget = await getCachedLegacyProductRedirectTarget(
    merchant.id,
    productSlug
  );
  if (!redirectTarget) {
    return null;
  }
  const productPath = getProductUrl(redirectTarget);
  return buildProductRedirectPath(storeSlug, productPath);
}

export async function resolveProductPage(
  props: PageProps
): Promise<ProductPageResolution> {
  const { params, searchParams } = props;
  const { slug, productSlug } = await params;
  const resolvedSearchParams = await searchParams;
  const productResult = await getRequestScopedProduct(slug, productSlug);
  if (!productResult) {
    notFound();
  }
  const { merchant, product } = productResult;
  if (!product) {
    const legacyRedirectPath = await getLegacyVariantProductRedirectPath(
      slug,
      productSlug,
      merchant
    );
    if (!legacyRedirectPath) {
      return { kind: 'route-not-found' };
    }
    permanentRedirect(asRoute(legacyRedirectPath));
  }
  const categorizedTarget = getCategorizedRedirectTarget(
    slug,
    product,
    resolvedSearchParams
  );
  if (categorizedTarget) {
    permanentRedirect(asRoute(categorizedTarget));
  }
  const invalidVariantTarget = getInvalidVariantSelectionRedirectTarget(
    slug,
    product,
    resolvedSearchParams
  );
  if (invalidVariantTarget) {
    redirect(asRoute(invalidVariantTarget));
  }

  return {
    kind: 'product',
    runtimeProps: {
      merchant,
      product,
      slug,
    },
  };
}
